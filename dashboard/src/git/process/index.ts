// The one place git is started as a process. Every git question and
// move in the dashboard goes through a `GitRunner`, injected so tests
// spawn nothing; `createGitRunner` is the real one.

import { NO_GIT_HOOKS } from "../../integrations/no-git-hooks.ts";

/** One git invocation. Injected so tests spawn no subprocess, and so a
 *  failure is a value (`code`) rather than an exception to be guessed at.
 *
 *  `stderr` is optional so a runner that does not set it — the fakes
 *  most tests use — still fits: a caller reads an absent `stderr` as
 *  git having given no reason. */
export type GitRunner = (
  dir: string,
  args: string[],
  /** Longer than the default for the rare call that is not a question.
   *  A clone is the case: the specs repository took 4.3 s on 2026-08-23
   *  and the 4 s default killed it, leaving a `.git` with `objects` and
   *  no `HEAD` — every run then refused, because the checkout it needed
   *  was a directory that was not a repository. Passed per call rather
   *  than by building a second runner, so an injected fake still sees
   *  every call the code makes. */
  timeoutMs?: number,
  /** Per-call environment additions. `GIT_INDEX_FILE`
   *  scoping — the plumbing `branch-file.ts` uses to build a commit
   *  without ever touching the shared checkout's real index — has no
   *  CLI-flag equivalent; it is env-var only. Optional and trailing, so
   *  every existing fake `GitRunner` in the test suite (declared with
   *  fewer parameters) stays valid under TypeScript's structural typing. */
  env?: Record<string, string>,
) => Promise<{ code: number; stdout: string; stderr?: string }>;

const DEFAULT_TIMEOUT_MS = 4000;

/** The real runner. `Bun.spawn` does NOT reject on a nonzero exit — a
 *  fetch for a branch the remote does not have, and a merge-base against
 *  an unfetched ref, both exit 128 quietly — so the code is read and
 *  returned rather than trusted to throw. The timeout is what stops an
 *  unreachable `origin` from stalling a page load: the queue polls every
 *  5 s and the job page refreshes every 10 s. */
export function createGitRunner(timeoutMs = DEFAULT_TIMEOUT_MS): GitRunner {
  return async (dir, args, callTimeoutMs, env) => {
    // A directory that is not there is an ANSWER, not a crash. `cwd` on
    // a missing path fails inside posix_spawn, and the error names the
    // command — "ENOENT ... posix_spawn 'git'" — so it reads as a
    // machine with no git rather than a path with no directory. Two
    // projects on this host have no specs root at all, and the branch
    // check walks every project's roots: the page threw (2026-08-23).
    let proc;
    try {
      proc = Bun.spawn({
        cmd: ["git", ...NO_GIT_HOOKS, ...args],
        cwd: dir,
        stdout: "pipe",
        // Read, not discarded: git says WHY a pull failed only here, and
        // "another process is holding index.lock" and "the base has
        // diverged" are the same exit code with different words.
        stderr: "pipe",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      });
    } catch (e) {
      return { code: 128, stdout: "", stderr: `cannot run git in ${dir}: ${String(e)}` };
    }
    const killer = setTimeout(() => proc.kill(), callTimeoutMs ?? timeoutMs);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      return { code, stdout, stderr };
    } finally {
      clearTimeout(killer);
    }
  };
}
