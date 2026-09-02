// The context every landing function reads instead of `createServer`'s
// closure, and the `Landing` description `landBranch` is driven by.

import type { QueueStore, BranchRef, Job, WorkflowStep } from "../../queue/queue.ts";
import type { BranchStatusChecker, GitRunner } from "../../git/branch-status.ts";
import type { WorkflowHistoryChecker, BranchFileStepsChecker } from "../../git/workflow-history.ts";
import type { SpecCreatedAtChecker, DescriptionFreshnessChecker } from "../../git/description-freshness.ts";
import type { MergeEventReporter } from "../../integrations/merge-event.ts";
import type { CodeLanding } from "../../project/discover.ts";
import type { QueueRowView } from "../../render.ts";
import type { createRootLock } from "../serve-helpers.ts";
import type { RestartHook } from "./restart.ts";

/** Everything `landBranch` and its helpers read off `createServer`'s
 *  closure, bundled the same way `HandleQueueContext` and
 *  `SpecViewsContext` bundle theirs. `invalidateScan` is the same
 *  getter/invalidator shape as `HandleQueueContext.invalidateScan` —
 *  both close over the same `scan` `let`. */
export interface LandContext {
  machineryProjectDir: (project: string) => string;
  codeLanding: (project: string) => CodeLanding;
  queue: QueueStore;
  mergeLock: ReturnType<typeof createRootLock>;
  gitRun: GitRunner;
  branchStatus: BranchStatusChecker;
  mergeEvents: MergeEventReporter;
  warmSpec: (t: { dir?: string; specFolder: string; reopenedAfter?: string }) => Promise<void>;
  machinerySpecsRoot: (project: string) => string | undefined;
  specsRoot: (dir: string) => Promise<string>;
  jobRow: (job: Job) => Promise<QueueRowView>;
  workflowHistory: WorkflowHistoryChecker;
  specCreatedAt: SpecCreatedAtChecker;
  freshness: DescriptionFreshnessChecker;
  /** Spec 298: the file half of the disagreement comparison, read from
   *  a spec's own open branch instead of the default-branch checkout's
   *  stale copy — what `withFreshness` prefers over `t.fileSteps` when
   *  it has a real answer. */
  branchFileSteps: BranchFileStepsChecker;
  rootsStillHolding: (project: string, branch: string, fresh: boolean) => Promise<string[]>;
  invalidateScan: () => void;
  queueInstallTimeoutMs: number | undefined;
  /** What restarts the dashboard server once a code-root install has
   *  succeeded, and how long that restart may wait for other landings
   *  to clear first (spec 287). */
  restart: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
}

/** What a landing does that is not the merge itself: what to write on
 *  the job when it worked, and what to say when it did not. Everything
 *  else — which repos, the retries, the per-repo report — is the same
 *  for every step, and is `landBranch`'s. */
export interface Landing {
  /** Beyond the standard `branchUrl`/`branchUrls`/`error` reset. A
   *  create step renames the job off its provisional key; an archive
   *  step has nothing to add. */
  landed?: Partial<Job>;
  /** What to say when the run pushed no branch at all. For `create`
   *  that IS the failure — the spec exists only on a branch that was
   *  never reported. For `archive` a HEAD that never moved is an
   *  ordinary outcome, so it says nothing and leaves no error. */
  nothingToLand?: string;
  /** The catch-all message, which has to name the step: "landing it
   *  failed" alone leaves a reader guessing what "it" was. */
  failedNote: (why: string) => string;
  /** Which repos to land. Absent means the step's own outcome, which
   *  is right for every landing but archive's — see
   *  `landArchivedSpec` for why that one has to look further. */
  repos?: BranchRef[];
  /** Which step's landing this is. Only the merge event reads it
   *  (spec 158), and it is taken from the call site rather than
   *  derived: `landStepBranch` already HAS the step as a parameter,
   *  and a second value worked out from the outcome would be a second
   *  thing that could be wrong. */
  step: WorkflowStep;
  /** What to do once the merge has actually landed — after the job
   *  has been updated and the scan invalidated, and only then (spec
   *  207). `archive`'s alone today: it writes what the spec cost in
   *  time into `4-status.md`, and a spec whose branch did not land is
   *  not archived, so there would be nothing to record.
   *
   *  Never fatal and never rethrown, exactly like `installAfterMerge`
   *  in the same function: the merge already happened, and turning a
   *  landed archive into a failed job would hand back a task nobody
   *  can act on. */
  onLanded?: () => Promise<void>;
}
