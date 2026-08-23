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
  /** Longer than the default for the rare call that is not a question.
   *  A clone is the case: the specs repository took 4.3 s on 2026-08-23
   *  and the 4 s default killed it, leaving a `.git` with `objects` and
   *  no `HEAD` — every run then refused, because the checkout it needed
   *  was a directory that was not a repository. Passed per call rather
   *  than by building a second runner, so an injected fake still sees
   *  every call the code makes. */
  timeoutMs?: number,
) => Promise<{ code: number; stdout: string; stderr?: string }>;

const DEFAULT_TIMEOUT_MS = 4000;
/** How long one answer stands. Exported since spec 203: the background
 *  drift poll runs on this same window, and a second constant for the
 *  same interval would one day be a different number. */
export const DEFAULT_TTL_MS = 30_000;

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

/** The same question about EVERY spec branch at once (spec 193), which
 *  is what both of `openSpecBranches`'s readers actually want: the
 *  landing checks one branch but the two pages check every archived
 *  spec, and one call per spec would be a page load per spec.
 *
 *  Deliberately WITHOUT `--exit-code`, unlike `lsRemoteBranch`: that
 *  flag makes "this repo has no open spec branch" an error, and that is
 *  the ordinary answer for a healthy repo. Absence is read off the
 *  output here, and only a nonzero exit means the question could not be
 *  answered at all. */
export function lsRemoteSpecBranches(): string[] {
  return ["ls-remote", "--heads", "origin", `refs/heads/${specBranch("*")}`];
}

/** The real runner. `Bun.spawn` does NOT reject on a nonzero exit — a
 *  fetch for a branch the remote does not have, and a merge-base against
 *  an unfetched ref, both exit 128 quietly — so the code is read and
 *  returned rather than trusted to throw. The timeout is what stops an
 *  unreachable `origin` from stalling a page load: the queue polls every
 *  5 s and the job page refreshes every 10 s. */
export function createGitRunner(timeoutMs = DEFAULT_TIMEOUT_MS): GitRunner {
  return async (dir, args, callTimeoutMs) => {
    // A directory that is not there is an ANSWER, not a crash. `cwd` on
    // a missing path fails inside posix_spawn, and the error names the
    // command — "ENOENT ... posix_spawn 'git'" — so it reads as a
    // machine with no git rather than a path with no directory. Two
    // projects on this host have no specs root at all, and the branch
    // check walks every project's roots: the page threw (2026-08-23).
    let proc;
    try {
      proc = Bun.spawn({
        cmd: ["git", ...args],
        cwd: dir,
        stdout: "pipe",
        // Read, not discarded: git says WHY a pull failed only here, and
        // "another process is holding index.lock" and "the base has
        // diverged" are the same exit code with different words.
        stderr: "pipe",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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
  /** Spec 142's answer, in its own map. `cache` holds a boolean and this
   *  one a number-or-null: widening the existing field's type would let
   *  either question be answered with the other's answer. */
  private readonly driftCache = new Map<string, { at: number; behind: number | null }>();
  /** Spec 193's answer, in a map of its own for the same reason
   *  `driftCache` has one: a set-or-null is not a boolean, and one
   *  field holding both would let either question be answered with the
   *  other's answer. */
  private readonly openCache = new Map<string, { at: number; open: Set<string> | null }>();

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

  /** How many commits `origin/<default>` has that this checkout does
   *  not. Spec 142: a merge made anywhere but the dashboard's own
   *  button runs no `AIDE_INSTALL_CMD`, so the serving host goes on
   *  serving the old code and nothing says so — this is what says so.
   *
   *  `0` when level or ahead. `null` where the answer cannot be
   *  trusted: no resolvable default branch, a checkout parked on some
   *  other branch (mid-investigation is not "behind", it is elsewhere —
   *  the same rule `aide-pull-specs` applies), or a git that errored or
   *  timed out. Fail-open, like `isMerged`: a banner nobody can trust
   *  is worse than no banner.
   *
   *  Reads only. The `--quiet` fetch of the default branch is what
   *  makes the count current, and is the same call `isMerged` already
   *  makes; nothing here merges, pulls or moves the checkout, because
   *  a page load that changed the code under a running server is the
   *  very thing nobody asked for. */
  async commitsBehindOrigin(projectDir: string): Promise<number | null> {
    const at = this.now();
    const hit = this.driftCache.get(projectDir);
    if (hit && at - hit.at < this.ttlMs) return hit.behind;

    let behind: number | null = null;
    try {
      const base = await this.defaultBranch(projectDir);
      if (base) {
        const current = await this.run(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
        if (current.code === 0 && current.stdout.trim() === base) {
          // Best effort, as it is in `isMerged`: whatever the checkout
          // already knows beats no answer at all.
          await this.run(projectDir, ["fetch", "--quiet", "origin", base]);
          const count = await this.run(projectDir, [
            "rev-list", "--count", `HEAD..refs/remotes/origin/${base}`,
          ]);
          if (count.code === 0) {
            const n = Number.parseInt(count.stdout.trim(), 10);
            if (Number.isFinite(n)) behind = n;
          }
        }
      }
    } catch {
      behind = null;
    }

    this.driftCache.set(projectDir, { at, behind });
    return behind;
  }

  /** The LAST answer this checker holds for `projectDir`, without asking
   *  git at all — a map read, nothing else (spec 203). This is what a
   *  page render calls: the render reads memory and disk, and the
   *  filling is `commitsBehindOrigin`'s job on a schedule of its own.
   *
   *  `checkedAt` is `null` only where NOTHING has ever been asked.
   *  Past the TTL the cached answer still comes back — stale, not
   *  withheld — so the row can label how old it is rather than fall
   *  silent. A `behind` of `null` with a real `checkedAt` is the
   *  existing fail-open case: asked, unanswerable. */
  peekDrift(projectDir: string): { behind: number | null; checkedAt: number | null } {
    const hit = this.driftCache.get(projectDir);
    return hit ? { behind: hit.behind, checkedAt: hit.at } : { behind: null, checkedAt: null };
  }

  /** Every `aide/*` branch origin still has in this root — the question
   *  "is anything of this spec still open" asked once per ROOT rather
   *  than once per branch (spec 193).
   *
   *  `null` means the question could not be ANSWERED: a transport
   *  failure, a timeout, no git. Every caller treats it as "do not
   *  claim anything", the same fail-open rule `isMerged` keeps — a
   *  network blip must not report every archived spec as unlanded, nor
   *  every unlanded one as finished. An empty set is the opposite: a
   *  real answer, and the ordinary one for a healthy repo.
   *
   *  `fresh` bypasses the cache AND replaces the entry. The landing
   *  needs it: it asks immediately after `mergeBranchIntoDefault` has
   *  deleted the branch on origin, so an answer cached up to 30 seconds
   *  earlier would report every successful landing as unlanded. */
  async openSpecBranches(root: string, fresh = false): Promise<Set<string> | null> {
    const at = this.now();
    const hit = this.openCache.get(root);
    if (!fresh && hit && at - hit.at < this.ttlMs) return hit.open;

    let open: Set<string> | null = null;
    try {
      const listed = await this.run(root, lsRemoteSpecBranches());
      if (listed.code === 0) {
        // `<sha>\t<full ref>` per line. The ref is taken whole and the
        // prefix stripped, so a branch whose name contains a tab in some
        // future world still parses as one field.
        open = new Set(
          listed.stdout
            .split("\n")
            .map((line) => line.slice(line.indexOf("\t") + 1).trim())
            .filter((ref) => ref.startsWith("refs/heads/"))
            .map((ref) => ref.slice("refs/heads/".length)),
        );
      }
    } catch {
      open = null;
    }

    this.openCache.set(root, { at, open });
    return open;
  }

  /** The LAST answer this checker holds for `root`, without asking git
   *  at all (spec 208) — the same read `peekDrift` gives the drift
   *  count, for the question spec 193 added a day after spec 203
   *  shipped the pattern, and added without it.
   *
   *  This is what a page render calls. `openSpecBranches` is a network
   *  `ls-remote`, one round trip to origin per root, and it sat inside
   *  `GET /` and `GET /archive` — which is how the spec list came to
   *  measure 6.7 seconds cold. `refreshSpecCaches` is what keeps this
   *  warm now; the reader never takes the answer itself.
   *
   *  `checkedAt` is `null` only where NOTHING has ever been asked, and
   *  `open` is then `null` too — which every caller already treats as
   *  "claim nothing", so an unwarmed root goes on failing CLOSED
   *  exactly as an unanswerable one does. Past the TTL the cached set
   *  still comes back — stale, not withheld — so the archive row can
   *  label how old it is. */
  peekOpenSpecBranches(root: string): { open: Set<string> | null; checkedAt: number | null } {
    const hit = this.openCache.get(root);
    return hit ? { open: hit.open, checkedAt: hit.at } : { open: null, checkedAt: null };
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
