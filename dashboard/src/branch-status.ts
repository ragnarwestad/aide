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
 *  failure is a value (`code`) rather than an exception to be guessed at.
 *
 *  `stderr` is optional because only one caller reads it — the
 *  index.lock retry in `branch-merge.ts` — and a runner that does not
 *  set it must behave exactly as it did before the field existed: an
 *  absent reason is not a reason to retry. */
export type GitRunner = (
  dir: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr?: string }>;

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_TTL_MS = 30_000;

/** `git ls-remote --exit-code`'s own answer for "the remote has no such
 *  ref". Documented by git and distinct from every other failure code,
 *  which is the whole reason absence can be asserted rather than
 *  guessed: `128` is an unreachable host and means nothing about
 *  whether the branch exists. Exported because both the read path
 *  (`isMerged`) and the write path (`branch-merge.ts`) ask origin the
 *  same question, and two copies of this number would one day disagree. */
export const LS_REMOTE_NO_MATCH = 2;

/** Ask origin — not a local remote-tracking ref — whether it still has
 *  this branch. */
export function lsRemoteBranch(branch: string): string[] {
  return ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`];
}

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
      // Read, not discarded: git says WHY a pull failed only here, and
      // "another process is holding index.lock" and "the base has
      // diverged" are the same exit code with different words.
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const killer = setTimeout(() => proc.kill(), timeoutMs);
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

  /** True only when git can PROVE there is nothing left to merge: the
   *  branch is an ancestor of the project's default branch, or origin
   *  no longer has it at all. Everything else — no checkout, no default
   *  branch, a git that errors or times out — is false: "not confirmed
   *  merged". Uncertainty leaves the caveat on the page rather than
   *  removing it. */
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
        // Origin is asked FIRST, and directly — the same idiom
        // `aide-run-spec`'s `dependency_branch_on_origin` already uses,
        // for the same reason: a local remote-tracking ref answers from
        // whatever this checkout last happened to fetch, and origin is
        // the only place the truth lives.
        //
        // A branch that is not there has nothing left to merge, whether
        // it landed and was cleaned up (which is what the merge button
        // does since spec 99) or was removed by hand. Only `--exit-code`'s
        // own "no matching refs" answer counts as absence: any other
        // nonzero code is a transport or auth failure, and treating one
        // of those as absence would take the badge and the button off
        // open work during a network blip.
        const onOrigin = await this.run(projectDir, lsRemoteBranch(branch));
        if (onOrigin.code === LS_REMOTE_NO_MATCH) return this.remember(key, at, true);
        // Best effort. Naming both refs explicitly still updates the
        // corresponding refs/remotes/origin/* on a normal clone, so a
        // merge done on someone else's machine is visible here without
        // fetching every branch. A failure is ignored: whatever the
        // checkout already knows is better than no answer.
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

    return this.remember(key, at, merged);
  }

  private remember(key: string, at: number, merged: boolean): boolean {
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
