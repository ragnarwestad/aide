// A job's row, and landing a step's branch when it finishes. Split out
// of serve.ts (split serve.ts by theme, restructuring createServer into
// staged setup functions to get it under 500 lines).
//
// Built before the runner stage, not after `Bun.serve()` the way it
// used to sit in the file: nothing here — `jobRow`, the land
// functions, `withFreshness` — reads `server` or `runner`, so there was
// never a real forward reference, only a historical ordering. Moving it
// earlier removes the one dependency the runner stage would otherwise
// need a box for: `runnerSetupCtx.landNewSpec` and its three siblings.

import type { BranchStatusChecker, GitRunner } from "../git/branch-status.ts";
import type { RepoMergeResult } from "../git/branch-merge.ts";
import type {
  DescriptionFreshnessChecker, SpecCreatedAtChecker,
} from "../git/description-freshness.ts";
import type { WorkflowHistoryChecker, BranchFileStepsChecker } from "../git/workflow-history.ts";
import type { CodeLanding } from "../project/discover.ts";
import type { AideRunStore } from "../queue/aide-run-store.ts";
import type { MergeEventReporter } from "../integrations/merge-event.ts";
import type { Job, QueueStore, WorkflowStep } from "../queue/queue.ts";
import type { StepOutcome } from "../queue/runner.ts";
import type { QueueTarget } from "../render.ts";
import { jobRow as jobRowImpl, type JobRowContext } from "./job-row.ts";
import {
  landNewSpec as landNewSpecImpl,
  landStepBranch as landStepBranchImpl,
  landStoppedStepBranch as landStoppedStepBranchImpl,
  landArchivedSpec as landArchivedSpecImpl,
  installAfterMerge as installAfterMergeImpl,
  restartAfterLanding,
  withFreshness as withFreshnessImpl,
  type LandContext,
  type RestartHook,
} from "./land-branch.ts";
import type { ServerState } from "./state.ts";

export interface LandSetupInputs {
  machineryProjectDir: (project: string) => string;
  displayProjectDir: (project: string) => string;
  codeLanding: (project: string) => CodeLanding;
  queue: QueueStore;
  store: AideRunStore;
  mergeLock: ReturnType<typeof import("./serve-helpers.ts").createRootLock>;
  gitRun: GitRunner;
  branchStatus: BranchStatusChecker;
  mergeEvents: MergeEventReporter;
  warmSpec: (t: { dir?: string; specFolder: string; reopenedAfter?: string }) => Promise<void>;
  machinerySpecsRoot: (project: string) => string | undefined;
  specsRoot: (dir: string) => Promise<string>;
  workflowHistory: WorkflowHistoryChecker;
  specCreatedAt: SpecCreatedAtChecker;
  freshness: DescriptionFreshnessChecker;
  branchFileSteps: BranchFileStepsChecker;
  rootsStillHolding: (project: string, branch: string, fresh: boolean) => Promise<string[]>;
  queueInstallTimeoutMs?: number;
  restart: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
}

export function setupLand(state: ServerState, inputs: LandSetupInputs) {
  const jobRowCtx: JobRowContext = {
    machineryProjectDir: inputs.machineryProjectDir,
    displayProjectDir: inputs.displayProjectDir,
    queue: inputs.queue,
    store: inputs.store,
  };
  function jobRow(job: Job) {
    return jobRowImpl(jobRowCtx, job);
  }

  // Built once, from the same locals landBranch and its helpers in
  // land-branch.ts used to close over directly — `invalidateScan` is
  // the same getter/invalidator shape the queue and SSE contexts use,
  // closing over the same `state.scan`.
  const landCtx: LandContext = {
    machineryProjectDir: inputs.machineryProjectDir,
    codeLanding: inputs.codeLanding,
    queue: inputs.queue,
    mergeLock: inputs.mergeLock,
    gitRun: inputs.gitRun,
    branchStatus: inputs.branchStatus,
    mergeEvents: inputs.mergeEvents,
    warmSpec: inputs.warmSpec,
    machinerySpecsRoot: inputs.machinerySpecsRoot,
    specsRoot: inputs.specsRoot,
    jobRow,
    workflowHistory: inputs.workflowHistory,
    specCreatedAt: inputs.specCreatedAt,
    freshness: inputs.freshness,
    branchFileSteps: inputs.branchFileSteps,
    rootsStillHolding: inputs.rootsStillHolding,
    invalidateScan: () => {
      state.scan = null;
    },
    queueInstallTimeoutMs: inputs.queueInstallTimeoutMs,
    restart: inputs.restart,
    restartPollMs: inputs.restartPollMs,
    restartDeferTimeoutMs: inputs.restartDeferTimeoutMs,
  };
  function landNewSpec(job: Job, outcome: Partial<StepOutcome>) {
    return landNewSpecImpl(landCtx, job, outcome);
  }
  function landStepBranch(job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) {
    return landStepBranchImpl(landCtx, job, step, outcome);
  }
  function landStoppedStepBranch(job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) {
    return landStoppedStepBranchImpl(landCtx, job, step, outcome);
  }
  function landArchivedSpec(job: Job, outcome: Partial<StepOutcome>) {
    return landArchivedSpecImpl(landCtx, job, outcome);
  }
  /** The deploy button's install, which owns its restart the way it
   *  always has: there is no repo loop behind it to be killed in the
   *  middle of. `landBranch` calls the implementation directly and
   *  fires the restart itself, once its own loop is through. */
  async function installAfterMerge(result: RepoMergeResult) {
    if (await installAfterMergeImpl(landCtx, result)) await restartAfterLanding(landCtx);
  }
  function withFreshness(list: QueueTarget[]) {
    return withFreshnessImpl(landCtx, list);
  }

  return {
    jobRow, landNewSpec, landStepBranch, landStoppedStepBranch, landArchivedSpec, installAfterMerge, withFreshness,
  };
}
