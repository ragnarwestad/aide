// What the landing test gate's tests set up alike: throwaway folders and
// the gate's environment cleared after each test, git run in a folder, and
// a repository with main committed.
import { afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The variables the gate reads its resolver, recorder and log from. */
const GATE_ENV = ["AIDE_RESOLVE_TEST_CMD_BIN", "AIDE_RECORD_TEST_RUN_BIN", "AIDE_TEST_GATE_LOG"];

/** Registers an `afterEach` that removes every path in `dirs` and clears
 *  the gate's variables and `extraEnv`. `temp(prefix)` makes a folder
 *  that is removed with them; a test pushes any other path onto `dirs`. */
export function gateTemps(extraEnv: string[] = []): { temp: (prefix: string) => string; dirs: string[] } {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    for (const key of [...GATE_ENV, ...extraEnv]) delete process.env[key];
  });
  const temp = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  return { temp, dirs };
}

/** Runs git in `cwd` and returns its output; throws with git's own words when it fails. */
export function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** Makes `dir` a repository on `main` with everything in it committed as `message`. */
export function commitAll(dir: string, message: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
}

/** main, and the merge checked out on top of it carrying the spec's change. */
export function mergedRepo(dir: string): string {
  writeFileSync(join(dir, "README.md"), "# p\n");
  commitAll(dir, "main");
  git(dir, "switch", "-q", "-c", "merge");
  writeFileSync(join(dir, "spec-change"), "x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "the spec");
  return dir;
}
