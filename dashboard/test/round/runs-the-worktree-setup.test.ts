// Aide's own test server is the round, so the round runs the manifest's
// `worktreeSetup` in the worktree it serves a branch from, as
// `aide-preview` does for every other project, and links the main
// checkout's node_modules only when the project sets none.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

const RUN = join(import.meta.dir, "run");
const dirs: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${proc.stderr.toString()}`);
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** An aide checkout with a branch to serve, whose manifest names `setup`. */
function checkout(setup: string | null): string {
  const aide = tmp("aide-round-setup-");
  git(aide, ["init", "-q", "-b", "main"]);
  mkdirSync(join(aide, "dashboard", "src", "serve"), { recursive: true });
  mkdirSync(join(aide, "dashboard", "node_modules"), { recursive: true });
  writeFileSync(join(aide, "dashboard", "src", "serve", "serve.ts"), "");
  writeFileSync(join(aide, ".gitignore"), "node_modules\n");
  mkdirSync(join(aide, ".aide"));
  writeFileSync(join(aide, ".aide", "project.yaml"), `name: aide\n${setup === null ? "" : `worktreeSetup: ${setup}\n`}`);
  git(aide, ["add", "-A"]);
  git(aide, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"]);
  git(aide, ["branch", "feature-x"]);
  return aide;
}

/** A port another server holds, so a round that got past its worktree
 *  stops there instead of serving. */
function decoyPort() {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ jobs: [] }) });
  return { port: server.port!, stop: () => server.stop(true) };
}

async function round(aide: string, port: number): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn({ cmd: ["/bin/bash", RUN, aide, "--branch", "feature-x", "--port", String(port), "--timeout", "5"], stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

describe("the round sets up the worktree it serves a branch from", () => {
  test("a set command runs there in place of the node_modules link (AC-3, AC-4)", async () => {
    const seen = join(tmp("aide-round-setup-seen-"), "seen");
    const aide = checkout(`echo installing-deps; if [ -L dashboard/node_modules ]; then echo linked > ${seen}; else echo own > ${seen}; fi`);
    const decoy = decoyPort();
    try {
      const { stderr } = await round(aide, decoy.port);
      expect(stderr).toContain("installing-deps");
      expect(stderr).toMatch(/^worktree setup: done in \d+s$/m);
      expect(readFileSync(seen, "utf-8").trim()).toBe("own");
    } finally {
      await decoy.stop();
    }
  });

  test("a failing command serves nothing, ends on the failure line and leaves no worktree (AC-7)", async () => {
    const aide = checkout("echo broken-lockfile; exit 3");
    const decoy = decoyPort();
    try {
      const { code, stderr } = await round(aide, decoy.port);
      expect(code).toBe(1);
      const lines = stderr.trim().split("\n");
      expect(lines.at(-1)).toMatch(/^worktree setup failed: echo broken-lockfile; exit 3 exited 3 after \d+s$/);
      expect(lines.at(-2)).toBe("broken-lockfile");
      const worktrees = Bun.spawnSync({ cmd: ["git", "-C", aide, "worktree", "list"] }).stdout.toString().trim().split("\n");
      expect(worktrees).toHaveLength(1);
    } finally {
      await decoy.stop();
    }
  });

  test("without the key node_modules is linked as before (AC-8)", async () => {
    const aide = checkout(null);
    const decoy = decoyPort();
    try {
      const { stderr } = await round(aide, decoy.port);
      expect(stderr).not.toContain("worktree setup");
      expect(existsSync(join(aide, "dashboard", "node_modules"))).toBe(true);
    } finally {
      await decoy.stop();
    }
  });
});
