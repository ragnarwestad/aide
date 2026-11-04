// What one repo's landing reports, and the one way a refusal is worded.

import type { BoardMessage, Sentence } from "../../i18n/message.ts";

export interface RepoMergeResult {
  root: string;
  ok: boolean;
  /** Why not, naming the repo — a refusal that does not say WHERE is
   *  the same failure as no refusal at all when two repos are in play. */
  error?: Sentence;
  /** Raw git output behind `error` — never part of
   *  `error`'s own text, which stays a fixed, resolution-bearing
   *  sentence naming where to act. Hover-only detail. */
  detail?: string;
  /** What happened to the project's install after ITS code landed, when
   *  anything did: a failure, a timeout, or the fact that nothing is
   *  configured and deploying is still a hand step. Never set when the
   *  install succeeded — one message about this repo's install state, or
   *  none. A merge is never turned back into a failure by it: the merge
   *  had already happened. */
  installError?: Sentence;
  /** The merge landed and was pushed, but the spec branch is still on
   *  origin. Reported for the same reason and in the same way as
   *  `installError`: the cleanup is what a later dependency check
   *  reads, so a failed one has to be visible — and the merge it
   *  follows is never turned back into a failure by it. */
  branchDeleteError?: Sentence;
  /** WHY it was refused, when the answer is one a machine acts on. Two
   *  refusals carry it and no others.
   *
   *  `"conflict"` is the one a `resolve` step could finish,
   *  and the row offers that step on the strength of this field.
   *
   *  `"gone"` is the one whose cached "not merged" answer the
   *  refusal itself just disproved: the landing invalidates
   *  `BranchStatusChecker` for exactly that branch rather than leaving
   *  the row reporting a branch that is not on origin for the rest of
   *  the 30 s TTL. 54 of the 75 refusals in the log were this one.
   *
   *  Every other refusal here (a base that will not fast-forward, a
   *  failed push) leaves it unset, and so does a merge that went
   *  through — none of them is something a step could be sent to fix.
   *
   *  `error` stays the sentence a person reads, and the page keeps
   *  showing that. This field exists so the page or the server can act
   *  on the strength of the reason without matching against that
   *  sentence: the text is joined with every other repo's before the
   *  page sees it, and a rewording would silently take the action away. */
  reason?: "conflict" | "gone" | "tests-red";
  /** This root's branch was DELETED, never merged — set only
   *  by `deleteBranchOnly`. `landBranch`'s own per-repo success branch
   *  reads this to skip the report and the install call a real merge
   *  would otherwise trigger: a root that never merged anything has
   *  nothing to report and nothing to install. */
  discarded?: boolean;
  /** The real `NN-slug` a `create` job's folder was renamed to, set only
   *  by `finalizeCreate` — landing's own finalize step,
   *  which runs under this merge's own retry loop rather than once
   *  outside it, since a `base` that moved between attempts changes the
   *  folder count the next attempt has to see fresh. Present only when
   *  a `finalizeCreate` was given and it succeeded. */
  assignedSpecFolder?: string;
}

/** Every refusal names the repo AND the branch. A landing merges
 *  several repos and reports them in one joined sentence, so a message
 *  that names only one of the two leaves the reader with the failure
 *  but not the thing to go and look at. `why` says what went wrong;
 *  this says where: the branch being merged, or — on the deploy path,
 *  which has no feature branch — the default branch it is bringing up
 *  to date. */
export const refuse = (root: string, ref: string, why: BoardMessage, detail?: string): RepoMergeResult => ({
  root,
  ok: false,
  error: { key: why.key, values: { ...why.values, ref, root } },
  ...(detail ? { detail } : {}),
});
