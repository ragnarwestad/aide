// `core/scripts/aide-preview` for real: a git repository with a branch,
// a command that serves on $PORT, and the one line the dashboard reads
// off the log to call a board up.
//
// The script is what a project OTHER than aide gets when someone asks
// to look at a spec's branch, so what is proven here is the contract
// the dashboard depends on: a worktree of that branch, the gitignored
// paths linked into it, "board up: pid N, <url>" on stdout, and a
// served process that outlives the script.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

const SCRIPT = join(import.meta.dir, "..", "..", "..", "core", "scripts", "aide-preview");

const git = (cwd: string, ...args: string[]): string => {
  const res = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(res.stderr)}`);
  return new TextDecoder().decode(res.stdout);
};

/** A checkout with a branch to look at, and a gitignored directory the
 *  worktree cannot carry — the case `worktreeLinks` exists for. */
/** Where the script puts its worktrees while these tests run: a
 *  throwaway directory, never the home directory's own. */
const previewDir = (): string => mkdtempSync(join(tmpdir(), "aide-preview-wt-"));

function checkout(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "aide-preview-repo-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), "name: demo\nworktreeLinks: node_modules\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(join(dir, "README.md"), "main\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  git(dir, "branch", "aide/1-demo");
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "marker"), "installed\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A free port, asked of the OS and given straight back. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

/** Output to a FILE, the way the dashboard runs it (`spawn` in
 *  `setup/test-servers.ts` hands it a log path). Through a pipe the
 *  served process writes into a reader that has gone away the moment
 *  this script exits, and dies of it — which is the test harness, not
 *  the script. */
function runPreview(dir: string, port: number, cmd: string, timeout = "20") {
  const log = join(mkdtempSync(join(tmpdir(), "aide-preview-log-")), "board.log");
  const where = previewDir();
  const res = Bun.spawnSync(
    [SCRIPT, dir, "--branch", "aide/1-demo", "--port", String(port), "--cmd", cmd, "--timeout", timeout],
    { env: { ...process.env, AIDE_PREVIEW_DIR: where }, stdout: Bun.file(log), stderr: Bun.file(log) },
  );
  return { code: res.exitCode, log: readFileSync(log, "utf-8"), where };
}

describe("aide-preview serves one branch", () => {
  test("it reports the board, links the gitignored paths in, and leaves the server running", async () => {
    const { dir, cleanup } = checkout();
    const port = await freePort();
    // Serves the worktree it was started in, so what answers proves
    // WHICH tree is being served.
    const result = runPreview(dir, port, `python3 -m http.server $PORT --bind 127.0.0.1`);
    try {
      expect(result.log).toMatch(/^board up: pid \d+, http:\/\/127\.0\.0\.1:\d+ — serving aide\/1-demo$/m);
      const pid = Number(/board up: pid (\d+)/.exec(result.log)![1]);
      expect(result.code).toBe(0);

      const listing = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      expect(listing).toContain("README.md");

      // The gitignored directory git could never carry into a worktree.
      const linked = await fetch(`http://127.0.0.1:${port}/node_modules/marker`);
      expect(await linked.text()).toBe("installed\n");

      process.kill(pid, "SIGTERM");
    } finally {
      cleanup();
    }
  });

  test("a branch nobody has refuses before anything is checked out", async () => {
    const { dir, cleanup } = checkout();
    const port = await freePort();
    try {
      const res = Bun.spawnSync([SCRIPT, dir, "--branch", "aide/nope", "--port", String(port), "--cmd", "true"], {
        env: { ...process.env, AIDE_PREVIEW_DIR: previewDir() },
      });
      expect(res.exitCode).toBe(2);
      expect(new TextDecoder().decode(res.stderr)).toContain("no such branch: aide/nope");
      expect(existsSync(join(dir, ".git", "worktrees"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("a command that never serves is a refusal, not a board", async () => {
    const { dir, cleanup } = checkout();
    const port = await freePort();
    try {
      const result = runPreview(dir, port, "exit 3");
      expect(result.code).toBe(1);
      expect(result.log).toContain("exited with code 3 before anything answered");
      expect(result.log).not.toContain("board up");
    } finally {
      cleanup();
    }
  });

  // A preview that did not come up leaves nothing behind: its worktree
  // held the branch checked out, and the next attempt on the same port
  // was the only thing that ever removed it.
  test("a command that exits leaves no worktree behind", async () => {
    const { dir, cleanup } = checkout();
    const port = await freePort();
    try {
      const result = runPreview(dir, port, "exit 3");
      expect(readdirSync(result.where)).toEqual([]);
      expect(git(dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("a command that never answers leaves no worktree behind either", async () => {
    const { dir, cleanup } = checkout();
    const port = await freePort();
    try {
      // A duration nothing else on the machine sleeps for, and a second
      // command after it so the shell has to start `sleep` as a child
      // rather than become it.
      const result = runPreview(dir, port, "sleep 31.7; true", "2");
      expect(result.code).toBe(1);
      expect(result.log).toContain("nothing answered");
      expect(readdirSync(result.where)).toEqual([]);
      // What the command started goes with it: nothing is left to hold
      // the port the next board is given.
      await new Promise((r) => setTimeout(r, 300));
      expect(Bun.spawnSync(["pgrep", "-f", "sleep 31.7"]).stdout.toString().trim()).toBe("");
    } finally {
      cleanup();
    }
  });
});
