// What one landing carries from step to step: the plan worked out before
// the first repo, and the tally the repo loop keeps for the checks after it.

import type { BranchRef, Job } from "../../../queue/queue.ts";
import type { StepOutcome } from "../../../queue/runner";
import type { Sentence } from "../../../messages/format.ts";
import type { RepoMergeResult } from "../../../git/branch-merge/index.ts";
import type { LandingPolicy } from "../policy/index.ts";
import type { LandContext, Landing } from "../types.ts";

export interface LandingPlan {
  policy: LandingPolicy;
  codeRoots: { has: (root: string) => boolean };
  codeFirst: boolean;
  repos: BranchRef[];
  /** Roots this landing deliberately does not merge: a project whose
   *  manifest says `codeLanding: pr` has its CODE reviewed before it
   *  reaches the default branch, and the run has already opened the
   *  pull request. The code root alone: the specs root is bookkeeping. */
  leaveOpen: (root: string) => boolean;
  /** A code root whose branch is deleted, never merged; the specs root
   *  merges normally. Specs inside the code root land their folder
   *  alone first (`handed.specOnly`). */
  discard: (root: string) => boolean;
}

export interface LandingTally {
  failures: Sentence[];
  // Raw git output behind each failure above, if any — joined the
  // same way, so a title carrying several repos' detail lines up
  // with the sentence it belongs to.
  failureDetails: string[];
  // Which refusal it was, when it is one the row can offer a way out
  // of. A conflict is the only one a `resolve` step could finish.
  reason: Job["errorReason"];
  landingTerminalReason: string | undefined;
  // A merge that succeeded but whose delete failed, per
  // repo. `leftBehindRoots` is what stops the post-loop check below
  // from re-flagging a root THIS loop already knows the story of;
  // `deleteErrors` is what the row reads afterwards instead of the
  // generic "not landed".
  deleteErrors: Sentence[];
  leftBehindRoots: Set<string>;
  retryUnlanded: Map<string, () => Promise<RepoMergeResult>>;
}

export interface LandingRun {
  ctx: LandContext;
  job: Job;
  outcome: Partial<StepOutcome>;
  what: Landing;
  branch: string;
  plan: LandingPlan;
  tally: LandingTally;
}

/** The repos in landing order and what each root gets.
 *
 *  What this step's landing does is its policy's (`policy/index.ts`):
 *  the order of the roots, what the code root gets, the origin check.
 *  `sort` is stable, so two repos of the same kind keep the order the
 *  run recorded them in. */
export function landingPlan(
  ctx: LandContext,
  job: Job,
  policy: LandingPolicy,
  codeRoots: LandingPlan["codeRoots"],
  recorded: BranchRef[],
): LandingPlan {
  const codeFirst = policy.codeFirst;
  const repos = [...recorded].sort((a, b) => {
    const av = Number(codeRoots.has(a.root));
    const bv = Number(codeRoots.has(b.root));
    return codeFirst ? bv - av : av - bv;
  });
  const leaveOpen = (root: string): boolean =>
    policy.codeRoot === "merge-unless-pr" && codeRoots.has(root) && ctx.codeLanding(job.project) === "pr";
  const discard = (root: string): boolean => policy.codeRoot === "discard" && codeRoots.has(root);
  return { policy, codeRoots, codeFirst, repos, leaveOpen, discard };
}

export function emptyTally(): LandingTally {
  return {
    failures: [],
    failureDetails: [],
    reason: undefined,
    landingTerminalReason: undefined,
    deleteErrors: [],
    leftBehindRoots: new Set<string>(),
    retryUnlanded: new Map<string, () => Promise<RepoMergeResult>>(),
  };
}
