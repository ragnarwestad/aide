// Spec 89: the dashboard's first WRITE path. Until now it only ever
// asked git a question (`branch-status.ts`); this merges a spec's branch
// into a repo's default branch and pushes the result.
//
// The shape is `aide-run-spec`'s, run the other way round. That script
// brings a REUSED spec branch up to date with the default branch —
// ff-only first, a real merge as the fallback, `merge --abort` and a
// named refusal on conflict (`update_branch_to_base` in
// `core/scripts/aide-run-spec`) — and
// has done so on every headless job. Merging the spec branch INTO the
// default branch is the same three decisions in the other direction, so
// it is the same three decisions here rather than a second opinion.
//
// Two properties are the point, not tidiness:
//
//   * NO half-merged tree is ever left behind. A conflict aborts and
//     refuses by name, so the next thing to touch that checkout — a
//     queued `aide-run-spec` run, or a person — finds it clean.
//   * ONE repo, ONE result. Several repos cannot be merged atomically,
//     and a single collective "ok" over two repos is exactly the blind
//     spot this whole spec exists to remove.

import type { GitRunner } from "./branch-status.ts";

export interface RepoMergeResult {
  root: string;
  ok: boolean;
  /** Why not, naming the repo — a refusal that does not say WHERE is
   *  the same failure as no refusal at all when two repos are in play. */
  error?: string;
  /** What happened to the project's install after ITS code landed, when
   *  anything did: a failure, a timeout, or the fact that nothing is
   *  configured and deploying is still a hand step. Never set when the
   *  install succeeded — one message about this repo's install state, or
   *  none. A merge is never turned back into a failure by it: the merge
   *  had already happened. */
  installError?: string;
}

const refuse = (root: string, why: string): RepoMergeResult => ({ root, ok: false, error: why });

/** git's own words when another process is holding the index. A run
 *  starting in the same second pulls the same checkout as a courtesy,
 *  and whoever gets there second sees this — not a divergence, just a
 *  lost race, and it refused three merges on 2026-08-18 as though the
 *  base had moved. */
const INDEX_LOCK = /index\.lock/;
/** Two retries: half a second at most, so a lock that is genuinely
 *  stuck still refuses in well under a second rather than holding the
 *  request open. */
const LOCK_RETRIES = 2;
const LOCK_WAIT_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Merge `branch` into `base` in `root`, and push. `base` is passed in
 *  rather than re-derived: the caller already resolved it through
 *  `BranchStatusChecker.defaultBranch()`, and one resolver for "which
 *  branch is the default" is the whole reason that method is public.
 *
 *  Never throws: a git that cannot run at all is a refusal like any
 *  other, because the caller is merging several repos and one of them
 *  blowing up must not take the report for the others with it. */
export async function mergeBranchIntoDefault(
  run: GitRunner,
  root: string,
  branch: string,
  base: string,
): Promise<RepoMergeResult> {
  try {
    // 1. A dirty tree is refused BEFORE anything that could touch
    //    history. No lock is needed between this and a headless run,
    //    but the reason changed with spec 91 and the old one is worth
    //    not believing: it used to be that whichever side got there
    //    first left the tree dirty, so the other refused. A run no
    //    longer dirties the main tree at all — it works in a worktree of
    //    its own and only ever fast-forwards this one. What the two can
    //    still collide over is `index.lock`, and there the run is the
    //    side that yields: its pull is a courtesy, recorded as
    //    `pullError` and never fatal, while a merge that loses the race
    //    is a named refusal the reader sees.
    const status = await run(root, ["status", "--porcelain"]);
    if (status.code !== 0) return refuse(root, `cannot read the working tree in ${root}`);
    if (status.stdout.trim()) return refuse(root, `the tree is dirty in ${root} — commit or stash it first`);

    // 2. Best effort, exactly as `isMerged()` does it: whatever the
    //    checkout already knows beats no answer at all.
    await run(root, ["fetch", "--quiet", "origin", base, branch]);

    // 3. Stand on the default branch, and bring it up to origin's. A
    //    push from a base that is behind would be rejected anyway, and
    //    a merge onto a stale base is a merge nobody reviewed.
    const switched = await run(root, ["switch", "-q", base]);
    if (switched.code !== 0) return refuse(root, `cannot switch to ${base} in ${root}`);
    const upstream = await run(root, ["rev-parse", "--abbrev-ref", "@{u}"]);
    if (upstream.code === 0) {
      let pulled = await run(root, ["pull", "-q", "--ff-only"]);
      // Only for the lock, and only a couple of times. Retrying every
      // pull failure would also delay the refusal a real divergence
      // deserves — and that refusal is the one that must stay immediate.
      for (let n = 0; pulled.code !== 0 && INDEX_LOCK.test(pulled.stderr ?? "") && n < LOCK_RETRIES; n++) {
        await sleep(LOCK_WAIT_MS);
        pulled = await run(root, ["pull", "-q", "--ff-only"]);
      }
      if (pulled.code !== 0) return refuse(root, `cannot fast-forward ${base} in ${root} — merge it by hand`);
    }

    // 4-5. `refs/remotes/origin/<branch>`, never a local `<branch>`.
    //      This host is not the machine `aide-run-spec` ran on, so a
    //      local ref of that name may be absent, or left over from an
    //      older run of the same spec. The remote-tracking ref is the
    //      one `isMerged()` already trusts, and step 2 made it current.
    const ref = `refs/remotes/origin/${branch}`;
    const ff = await run(root, ["merge", "-q", "--ff-only", ref]);
    if (ff.code !== 0) {
      const real = await run(root, ["merge", "-q", "--no-edit", ref]);
      if (real.code !== 0) {
        await run(root, ["merge", "--abort"]);
        return refuse(root, `cannot merge ${branch} into ${base} in ${root} (conflict — merge it by hand)`);
      }
    }

    // 6. `isMerged()` only trusts what reached origin, so a merge this
    //    action does not push would show as "not merged" on the very
    //    page that triggered it. A push that fails is REPORTED and
    //    never rolled back — `aide-run-spec`'s own precedent is that a
    //    push problem is not a reason to undo committed work.
    const pushed = await run(root, ["push", "-q", "origin", base]);
    if (pushed.code !== 0) {
      return refuse(root, `merged locally in ${root}, but the push of ${base} failed`);
    }
    return { root, ok: true };
  } catch (err) {
    return refuse(root, `git could not be run in ${root}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
