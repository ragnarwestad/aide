// After the repo loop: does origin still hold the branch anywhere this
// landing was meant to merge it?

import { LANDING_RETRIES } from "../../../git/branch-merge/index.ts";
import type { LandingRun } from "./run.ts";

/** Origin decides, not the queue's memory of its own pushes.
 *  Archive's contract is that nothing of the spec stays
 *  open, and the loop before this can only merge repos it was TOLD
 *  about — a step run by hand, a job the LRU cap has evicted, a
 *  push that half-succeeded, all leave a branch no `branchUrls`
 *  entry ever mentioned. Three specs reached the archive that way
 *  with every row saying done.
 *
 *  `fresh`, because `mergeBranchIntoDefault` has just deleted the
 *  branch on origin and a cached answer would report every
 *  successful landing as unlanded.
 *
 *  Only where the policy asks for it: an `analyze` landing runs while
 *  implement's code branch is legitimately open, and the same check
 *  there would call a healthy landing failed.
 *  The gate stopping the landing is its own case: nothing was merged
 *  and nothing was pushed, so of course the branch is still on
 *  origin. The gate's own verdict says so, and names the branch the
 *  work is on — one sentence, and nothing added beside it.
 *  One reason per row. A landing that has already said why it failed
 *  (a conflict, a rejected push) is not joined by this check: it
 *  exists for the landing that reported ok while a branch stayed on
 *  origin, and beside a conflict its "run archive again" — once per
 *  root — contradicted the sentence the reader had just been given. */
export async function checkOrigin(run: LandingRun): Promise<void> {
  const { tally, branch } = run;
  if (!run.plan.policy.checksOrigin || tally.reason === "tests-red" || tally.failures.length > 0) return;
  await retryUnlandedRoots(run);
  const holding = await rootsStillHolding(run);
  if (!holding.length) return;
  // One sentence however many roots hold the branch: the roots
  // are data inside it, never a sentence each. It carries the
  // move as well as the state: the way out is the step that just
  // ran, and the row's own button already offers it. Phrased as
  // an instruction rather than as a quote of that button's label,
  // so a future rename leaves the sentence less exact but never
  // wrong.
  tally.failures.push(
    holding.length === 1
      ? { key: "landing.stillOnOriginRunArchiveAgain", values: { branch, root: holding[0]! } }
      : { key: "landing.stillOnOriginRunArchiveAgainMany", values: { branch, roots: holding } },
  );
  // Only where nothing more specific was found: a conflict is
  // the reason, and "unlanded" is what a conflict LOOKS like
  // from origin.
  tally.reason ??= "unlanded";
}

async function retryUnlandedRoots(run: LandingRun): Promise<void> {
  const { ctx, job, branch, plan, tally } = run;
  for (let n = 0; n < LANDING_RETRIES.originRechecks; n++) {
    for (const root of await ctx.rootsStillHolding(job.project, branch, true)) {
      const retry = plan.leaveOpen(root) || tally.leftBehindRoots.has(root) ? undefined : tally.retryUnlanded.get(root);
      if (retry && (await retry()).ok) ctx.branchStatus.invalidate(root, branch);
    }
  }
}

async function rootsStillHolding(run: LandingRun): Promise<string[]> {
  const { ctx, job, branch, plan, tally } = run;
  const holding: string[] = [];
  for (const root of await ctx.rootsStillHolding(job.project, branch, true)) {
    // A root the loop CHOSE not to merge is not a root that
    // failed to merge. Without this, every working
    // PR-mode archive reports itself as an unlanded failure — the
    // check asks origin about the project's roots with no
    // knowledge of which ones the landing skipped, and in `pr`
    // mode the code root always still holds the branch, by design.
    if (plan.leaveOpen(root)) continue;
    // This loop already knows WHY this root still holds the branch:
    // its own merge just succeeded and only the delete failed.
    // Not a second, contradicting "not landed" — `deleteErrors`
    // already carries the sentence that says what actually
    // happened, and the row reads it from there.
    if (tally.leftBehindRoots.has(root)) continue;
    holding.push(root);
  }
  return holding;
}
