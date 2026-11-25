// One repo's merge inside a landing: the default branch it merges into,
// the merge under the repo's lock, its retries, and a refusal recorded.

import { dispatchFor } from "../../../queue/waiting/dispatch.ts";
import { mergeWaitEntry } from "../../../queue/waiting/jobs.ts";
import type { BranchRef } from "../../../queue/queue.ts";
import { deleteBranchOnly, LANDING_RETRIES, landingRepeats, mergeBranchIntoDefault, type RepoMergeResult } from "../../../git/branch-merge/index.ts";
import { landSpecFolderOnly } from "../../../git/spec-folder-landing.ts";
import { isGoneHistoryRoot, logSkippedRoot } from "../gone-root.ts";
import { handedToMerge } from "../handed-to-merge.ts";
import { landingCancelled } from "../cancel-landing.ts";
import type { LandingRun } from "./run.ts";

/** Which refusal a row gets when the retries failed too: the FIRST one,
 *  which says what actually happened, unless a retry reached a verdict
 *  of its own (a conflict, a red suite). A retry that merely refused
 *  again used to overwrite "main moved on origin under this landing
 *  twice" with "cannot fast-forward main". */
export function pickRefusal(first: RepoMergeResult, last: RepoMergeResult): RepoMergeResult {
  if (first.ok) return last;
  if (last.reason && last.reason !== first.reason) return last;
  return { ...last, error: first.error, detail: first.detail ?? last.detail, reason: first.reason };
}

type Handed = ReturnType<typeof handedToMerge>;

/** What the loop does after one repo: go on, stop the loop, return at
 *  once, or handle a merge that succeeded. */
export type RepoStep = "next" | "stop" | "cancelled" | { merged: RepoMergeResult; handed: Handed };

export async function mergeRepo(run: LandingRun, repo: BranchRef): Promise<RepoStep> {
  const { ctx, job, what, branch, plan, tally } = run;
  if (plan.leaveOpen(repo.root)) {
    // Nothing merged, nothing deleted, nothing installed: the code
    // is on its branch, which is where the review happens, and
    // installing it here would deploy exactly the change the
    // review exists to hold back.
    console.error(
      `queue: landing ${job.project}/${job.specFolder} in ${repo.root} — left open for review (codeLanding: pr)`,
    );
    return "next";
  }
  const base = await ctx.branchStatus.defaultBranch(repo.root);
  if (!base) {
    if (isGoneHistoryRoot(repo.root, plan.repos, run.outcome.branchUrls ?? [])) {
      logSkippedRoot(job, repo.root);
      return "next";
    }
    // Guessing which branch to merge INTO is the one guess with no
    // safe direction.
    tally.failures.push({ key: "landing.cannotWorkOutDefaultBranch", values: { root: repo.root } });
    return "next";
  }
  const handed = handedToMerge(ctx, job, what, repo.root, branch, plan.codeRoots);
  const merge = mergeUnderLock(run, repo.root, base, handed);
  tally.retryUnlanded.set(repo.root, merge);
  const first = await merge();
  if (what.cancelled?.()) return "cancelled";
  const result = await retried(merge, first, !!handed.specOnly);
  if (result.ok) return { merged: result, handed };
  if (result.reason === "gone") {
    // Nothing to land in this repo, and not a failure of this
    // landing. An archive looks back through every
    // branch the spec's steps pushed, and a
    // `resolve` lands AND DELETES its own — so by the time archive
    // gets here, that branch is provably gone. Job 15932abc
    // (2026-08-21) was the first: archived, `ok: true`, and an
    // error on the row saying there was nothing left to merge.
    //
    // The refusal also disproves the cached answer from the other
    // side: the branch is not on origin at all.
    ctx.branchStatus.invalidate(repo.root, branch);
    return "next";
  }
  return recordRefusal(run, repo.root, result);
}

/** The merge itself, under the repo's lock.
 *
 *  Repeated after a refusal as often as `landingRepeats` says
 *  (`LANDING_RETRIES`, the one place every landing bound is written).
 *
 *  The lock goes around the git-mutating call and nothing else:
 *  `defaultBranch` before it only asks a question, and holding the
 *  root while asking it would serialize page loads too. */
function mergeUnderLock(run: LandingRun, root: string, base: string, handed: Handed): () => Promise<RepoMergeResult> {
  const { ctx, job, what, branch, plan } = run;
  return () =>
    dispatchFor(ctx.queue.waiting).run(
      mergeWaitEntry(ctx.queue, job, what.step, root, branch),
      ctx.mergeLock, root,
      () => {
        ctx.queue.update(job.id, { landBegan: true });
        return handed.specOnly
          ? landSpecFolderOnly(ctx.gitRun, root, branch, base, handed.specOnly)
          : plan.discard(root)
            ? deleteBranchOnly(ctx.gitRun, root, branch)
            : mergeBranchIntoDefault(ctx.gitRun, root, branch, base, undefined, handed.gate, handed.finalizeCreate, handed.hooks);
      },
      () => !!what.cancelled?.() || landingCancelled(job.id) || ctx.queue.get(job.id)?.state === "cancelled",
    );
}

/** The merge repeated after a refusal; a red suite is an answer, since
 *  the gate already gave it its retry. */
async function retried(merge: () => Promise<RepoMergeResult>, first: RepoMergeResult, specOnly: boolean): Promise<RepoMergeResult> {
  let result = first;
  const repeats = landingRepeats(first, specOnly);
  for (
    let retry = 0;
    !result.ok && result.reason !== "tests-red" && retry < repeats;
    retry++
  ) {
    await new Promise((r) => setTimeout(r, LANDING_RETRIES.repeatWaitMs * (retry + 1)));
    result = await merge();
  }
  if (!result.ok) result = pickRefusal(first, result);
  return result;
}

function recordRefusal(run: LandingRun, root: string, result: RepoMergeResult): "next" | "stop" {
  const { tally, branch, plan } = run;
  tally.failures.push(result.error ?? { key: "landing.cannotMergeFallback", values: { branch, root } });
  if (result.detail) tally.failureDetails.push(result.detail);
  if (result.reason === "conflict") tally.reason = "conflict";
  if (result.reason === "tests-red") tally.reason = tally.landingTerminalReason = "tests-red";
  if (result.reason === "timeout") tally.landingTerminalReason = "timeout";
  // Code first: a code root that fails to land stops the loop
  // here, before the specs root's own merge has run.
  return plan.codeFirst && plan.codeRoots.has(root) ? "stop" : "next";
}
