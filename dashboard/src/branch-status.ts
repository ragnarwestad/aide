// Spec 04: has a job's branch actually landed? The queue knows where a
// step pushed its work (`job.branchUrl`) but never whether that work is
// still sitting there. The answer changes AFTER the job stops running,
// so it cannot be recorded at step end — it has to be asked, live, of
// the project's own checkout.
//
// Local git only: no `gh`, no token, no GitHub. `origin` is already
// whatever host the checkout was cloned from, and a merge here is a real
// merge commit, so `merge-base --is-ancestor` answers the question for
// every push mode this project uses.

import { join } from "node:path";

/** The branch a step pushes to: the convention documented in README.md
 *  ("aide/<spec-folder>"), which is why the NAME is not stored on Job. */
export function specBranch(specFolder: string): string {
  return `aide/${specFolder}`;
}

/** One git invocation. Injected so tests spawn no subprocess, and so a
 *  failure is a value (`code`) rather than an exception to be guessed at. */
export type GitRunner = (dir: string, args: string[]) => Promise<{ code: number; stdout: string }>;

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_TTL_MS = 30_000;

/** The real runner. `Bun.spawn` does NOT reject on a nonzero exit — a
 *  fetch for a branch the remote does not have, and a merge-base against
 *  an unfetched ref, both exit 128 quietly — so the code is read and
 *  returned rather than trusted to throw. The timeout is what stops an
 *  unreachable `origin` from stalling a page load: the queue polls every
 *  5 s and the job page refreshes every 10 s. */
export function createGitRunner(timeoutMs = DEFAULT_TIMEOUT_MS): GitRunner {
  return async (dir, args) => {
    const proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd: dir,
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const killer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      return { code, stdout };
    } finally {
      clearTimeout(killer);
    }
  };
}

export interface BranchStatusOptions {
  run: GitRunner;
  /** How long one answer stands. Without it, every poll of every page
   *  would spawn git for every branch on the board. */
  ttlMs?: number;
  now?: () => number;
}

export class BranchStatusChecker {
  private readonly run: GitRunner;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; merged: boolean }>();

  constructor(opts: BranchStatusOptions) {
    this.run = opts.run;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** True only when the branch is provably an ancestor of the project's
   *  default branch. Everything else — no checkout, no default branch,
   *  a git that errors or times out — is false: "not confirmed merged".
   *  Uncertainty leaves the caveat on the page rather than removing it. */
  async isMerged(projectDir: string, branch: string): Promise<boolean> {
    // JSON, not a control character: a path cannot contain an
    // unescaped quote, so the pair is still unambiguous — and the file
    // stays text. A NUL here made git classify this source file as
    // binary, which costs every future diff and review of it.
    const key = JSON.stringify([projectDir, branch]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && at - hit.at < this.ttlMs) return hit.merged;

    let merged = false;
    try {
      const base = await this.defaultBranch(projectDir);
      if (base) {
        // Best effort. Naming both refs explicitly still updates the
        // corresponding refs/remotes/origin/* on a normal clone, so a
        // merge done on someone else's machine is visible here without
        // fetching every branch. A failure is ignored: whatever the
        // checkout already knows is better than no answer.
        //
        // Known limitation: a workflow that DELETES the branch on merge
        // leaves `refs/remotes/origin/<branch>` unresolvable, and the
        // check below degrades to false — the badge keeps showing on
        // work that has actually landed. That is the safe direction; the
        // opposite would claim merged work that is not.
        await this.run(projectDir, ["fetch", "--quiet", "origin", base, branch]);
        const ancestor = await this.run(projectDir, [
          "merge-base", "--is-ancestor",
          `refs/remotes/origin/${branch}`,
          `refs/remotes/origin/${base}`,
        ]);
        merged = ancestor.code === 0;
      }
    } catch {
      merged = false;
    }

    this.cache.set(key, { at, merged });
    return merged;
  }

  /** Drop one cached answer. A merge performed by this process changes
   *  the answer it just cached, and a reader who presses Merge and
   *  reloads must not be told "not merged" for the rest of the TTL. */
  invalidate(projectDir: string, branch: string): void {
    this.cache.delete(JSON.stringify([projectDir, branch]));
  }

  /** Not uniform across projects: this repo is `master`, others `main`.
   *  origin/HEAD is set by a normal clone and is the honest answer;
   *  the probe is for a checkout where that ref is somehow absent.
   *
   *  Public because the merge path needs the SAME answer this check
   *  uses — two resolvers for one question would eventually disagree,
   *  and the one that decides where a merge lands is not the one to get
   *  it wrong. */
  async defaultBranch(projectDir: string): Promise<string | null> {
    const head = await this.run(projectDir, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    if (head.code === 0) {
      const name = head.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
      if (name) return name;
    }
    for (const candidate of ["main", "master"]) {
      const found = await this.run(projectDir, [
        "show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`,
      ]);
      if (found.code === 0) return candidate;
    }
    return null;
  }
}

/** Where a project is checked out on this machine — the same resolution
 *  the runner already uses for the directory it runs a spec in. */
export function projectCheckout(root: string | undefined, project: string): string {
  return join(root ?? "", project);
}
