// The Merge runs the project's `worktreeSetup` in the worktree it tests the
// merged result in, before the tests, and a setup that fails stops the
// Merge before any test runs or any repair is asked for.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";

const SETUP = join(import.meta.dir, "../../../../../core/scripts/aide-worktree-setup");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  for (const key of ["AIDE_RESOLVE_TEST_CMD_BIN", "AIDE_RECORD_TEST_RUN_BIN", "AIDE_TEST_GATE_LOG", "AIDE_WORKTREE_SETUP_BIN"]) delete process.env[key];
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A project whose untracked manifest names `setup`, and fakes for the
 *  resolver and the recorder; the recorder notes whether the setup's
 *  marker was in its tree when it ran. */
function project(setup: string | null, setupBin = SETUP) {
  const root = temp("aide-gate-setup-");
  writeFileSync(join(root, ".gitignore"), ".aide/project.yaml\n");
  writeFileSync(join(root, "README.md"), "# p\n");
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "T"], ["config", "user.email", "t@e.x"], ["add", "-A"], ["commit", "-qm", "main"]]) {
    Bun.spawnSync({ cmd: ["git", "-C", root, ...args] });
  }
  mkdirSync(join(root, ".aide"), { recursive: true });
  writeFileSync(join(root, ".aide", "project.yaml"), `name: p\n${setup === null ? "" : `worktreeSetup: ${setup}\n`}`);
  const bin = temp("aide-gate-setup-bin-");
  const seen = join(bin, "recorder-saw.txt");
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["make test"]}\\n'\n`, { mode: 0o755 });
  writeFileSync(
    join(bin, "record"),
    "#!/bin/sh\n" +
      'while [ $# -gt 0 ]; do [ "$1" = "--project-dir" ] && dir="$2"; shift; done\n' +
      `if [ -f "$dir/setup-marker" ]; then echo marker >> ${seen}; else echo none >> ${seen}; fi\nexit 0\n`,
    { mode: 0o755 },
  );
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
  process.env.AIDE_WORKTREE_SETUP_BIN = setupBin;
  const streamFile = join(bin, "j1.archive.stream.jsonl");
  const runLog = join(bin, "j1.archive.run.log");
  writeFileSync(runLog, "");
  const job = { id: "j1", project: "p", specFolder: "1-x", streamFile, stepStartedAt: new Date().toISOString() };
  return { root, seen, runLog, job };
}

test("the setup runs in the gate's worktree before the tests, and its output and time are in the step's log (AC-2, AC-4)", async () => {
  const { root, seen, runLog, job } = project("echo installing-deps; touch setup-marker");
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/1-x", { button: "Archive" });
  expect(verdict.ok).toBe(true);
  expect(readFileSync(seen, "utf-8").trim()).toBe("marker");
  // Never in the live checkout.
  expect(existsSync(join(root, "setup-marker"))).toBe(false);
  const log = readFileSync(runLog, "utf-8");
  expect(log).toContain("installing-deps");
  expect(log).toMatch(/worktree setup: done in \d+s$/m);
}, 30_000);

test("a failing setup stops the Merge before the tests, without a repair, naming the command with its output (AC-6)", async () => {
  const { root, seen, runLog, job } = project("echo broken-lockfile; exit 3");
  let repaired = false;
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/1-x", {
    button: "Archive",
    repair: async () => (repaired = true),
  });
  expect(verdict.ok).toBe(false);
  expect(verdict.error).toEqual({ key: "landing.worktreeSetupFailed", values: { command: "echo broken-lockfile; exit 3", branch: "aide/1-x", button: "Archive" } });
  expect(verdict.detail).toContain("broken-lockfile");
  expect(existsSync(seen)).toBe(false);
  expect(repaired).toBe(false);
  expect(readFileSync(runLog, "utf-8")).toMatch(/error: worktree setup failed: echo broken-lockfile; exit 3 exited 3 after \d+s$/m);
}, 30_000);

test("a setup that does not finish in time stops the Merge the same way, and runs as the job's own process (AC-6)", async () => {
  // A stand-in for the command that answers as a timed-out one does, and
  // notes the arguments it was given.
  const bin = temp("aide-gate-setup-fake-");
  const args = join(bin, "args.txt");
  writeFileSync(
    join(bin, "setup"),
    `#!/bin/sh\necho "$@" > ${args}\necho 'worktree setup failed: pnpm install did not finish within 900s' >&2\n` +
      `echo '{"ok":false,"ran":true,"command":"pnpm install","timedOut":true,"seconds":900,"tail":"resolving"}'\nexit 1\n`,
    { mode: 0o755 },
  );
  const { root, seen, job } = project("pnpm install", join(bin, "setup"));
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/1-x", { button: "Archive" });
  expect(verdict.ok).toBe(false);
  expect(verdict.error).toMatchObject({ key: "landing.worktreeSetupFailed" });
  expect(verdict.detail).toBe("resolving");
  expect(existsSync(seen)).toBe(false);
  expect(readFileSync(args, "utf-8")).toContain("--timeout 900");
}, 30_000);

test("without the key the gate runs no setup and tests as before (AC-8)", async () => {
  const bin = temp("aide-gate-setup-never-");
  const called = join(bin, "called");
  writeFileSync(join(bin, "setup"), `#!/bin/sh\ntouch ${called}\necho '{"ok":true,"ran":false}'\n`, { mode: 0o755 });
  const { root, seen, runLog, job } = project(null, join(bin, "setup"));
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/1-x", { button: "Archive" });
  expect(verdict.ok).toBe(true);
  expect(readFileSync(seen, "utf-8").trim()).toBe("none");
  expect(existsSync(called)).toBe(false);
  expect(readFileSync(runLog, "utf-8")).not.toContain("worktree setup");
}, 30_000);
