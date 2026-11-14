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

import type { BranchStatusChecker } from "../../git/branch-status.ts";
import type { GitRunner } from "../../git/process/index.ts";
import type {
  DescriptionFreshnessChecker, SpecCreatedAtChecker,
} from "../../git/description-freshness.ts";
import type { WorkflowHistoryChecker, BranchFileStepsChecker } from "../../git/workflow-history.ts";
import type { CodeLanding } from "../../project/discover";
import type { AideRunStore } from "../../queue/aide-run-store.ts";
import type { Job, QueueStore, WorkflowStep } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner";
import type { SpecTarget } from "../../render";
import { jobRow as jobRowImpl, type JobRowContext } from "../job-row.ts";
import {
  landNewSpec as landNewSpecImpl,
  landStepBranch as landStepBranchImpl,
  landStoppedStepBranch as landStoppedStepBranchImpl,
  landArchivedSpec as landArchivedSpecImpl,
  landClosedSpec as landClosedSpecImpl,
  landScheduleRun as landScheduleRunImpl,
  withFreshness as withFreshnessImpl,
  deleteLeftBehindBranch as deleteLeftBehindBranchImpl,
  type LandContext,
} from "../land-branch";
import { installCheckout, isDashboardRoot, restartAfterLanding, type DeployHooks, type RestartHook } from "../deployment";
import { setDeployFailure, setDeployFault, setPendingRestart, type ServerState } from "../state.ts";
import { createDeployJob } from "../deploy-job/index.ts";
import type { TestServersContext } from "../test-servers/lifecycle.ts";

export interface LandSetupInputs {
  machineryProjectDir: (project: string) => string;
  displayProjectDir: (project: string) => string;
  codeLanding: (project: string) => CodeLanding;
  queue: QueueStore;
  store: AideRunStore;
  mergeLock: ReturnType<typeof import("../serve-helpers").createRootLock>;
  gitRun: GitRunner;
  branchStatus: BranchStatusChecker;
  warmSpec: (t: { dir?: string; specFolder: string; reopenedAfter?: string }) => Promise<void>;
  machinerySpecsRoot: (project: string) => string | undefined;
  specsRoot: (dir: string) => Promise<string>;
  workflowHistory: WorkflowHistoryChecker;
  specCreatedAt: SpecCreatedAtChecker;
  freshness: DescriptionFreshnessChecker;
  branchFileSteps: BranchFileStepsChecker;
  forgetSpec: (dir: string, specFolder: string) => void;
  rootsStillHolding: (project: string, branch: string, fresh: boolean) => Promise<string[]>;
  queueInstallTimeoutMs?: number;
  restart: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
  dashboardRoot?: string;
  landingGate?: LandContext["landingGate"];
  finalizeCreateSpec?: LandContext["finalizeCreateSpec"];
  translationMergeArgs?: LandContext["translationMergeArgs"];
  testServers: TestServersContext;
}

export function setupLand(state: ServerState, inputs: LandSetupInputs) {
  const jobRowCtx: JobRowContext = {
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
    pullRequests: state.pullRequests,
    queue: inputs.queue,
    mergeLock: inputs.mergeLock,
    gitRun: inputs.gitRun,
    branchStatus: inputs.branchStatus,
    warmSpec: inputs.warmSpec,
    machinerySpecsRoot: inputs.machinerySpecsRoot,
    specsRoot: inputs.specsRoot,
    workflowHistory: inputs.workflowHistory,
    specCreatedAt: inputs.specCreatedAt,
    freshness: inputs.freshness,
    branchFileSteps: inputs.branchFileSteps,
    forgetSpec: inputs.forgetSpec,
    rootsStillHolding: inputs.rootsStillHolding,
    invalidateScan: () => {
      state.scan = null;
    },
    queueInstallTimeoutMs: inputs.queueInstallTimeoutMs,
    dashboardRoot: inputs.dashboardRoot,
    landingGate: inputs.landingGate,
    finalizeCreateSpec: inputs.finalizeCreateSpec,
    translationMergeArgs: inputs.translationMergeArgs,
    testServers: inputs.testServers,
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
  function landClosedSpec(job: Job, outcome: Partial<StepOutcome>) {
    return landClosedSpecImpl(landCtx, job, outcome);
  }
  function landScheduleRun(job: Job, outcome: Partial<StepOutcome>) {
    return landScheduleRunImpl(landCtx, job, outcome);
  }
  /** What the deploy routes and the deploy job ask of the landing code:
   *  the install, the restart check and the restart itself. */
  const deploy: DeployHooks = {
    installCheckout: (root) => installCheckout(root, inputs.queueInstallTimeoutMs),
    restartRegistered: () => inputs.restart.registered(),
    isBoard: (root) => isDashboardRoot(landCtx, root),
    // The deploy job's restart waits as long as landings take: nothing may
    // be cut short, so no deadline.
    restartWhenSettled: ({ onWait, beforeFire }) =>
      restartAfterLanding({
        mergeLock: inputs.mergeLock,
        restart: inputs.restart,
        restartPollMs: inputs.restartPollMs,
        restartDeferTimeoutMs: Infinity,
        queue: inputs.queue,
        onJobsWaitChange: (jobs) => {
          setPendingRestart(state, jobs);
          onWait(jobs);
        },
        beforeFire,
      }),
  };
  /** The board's own deploy as a job: the runner starts it through
   *  `start`, and the next process finishes it at boot. */
  const deployJob = createDeployJob({
    queue: inputs.queue,
    projectRoot: inputs.machineryProjectDir,
    isBoard: deploy.isBoard,
    gitRun: inputs.gitRun,
    branchStatus: inputs.branchStatus,
    mergeLock: inputs.mergeLock,
    installCheckout: deploy.installCheckout,
    restartRegistered: deploy.restartRegistered,
    restartWhenSettled: deploy.restartWhenSettled,
    readServing: () => ({ sha: state.servingSha, repoRoot: state.servingRepoRoot }),
    setFailure: (project, failure) => setDeployFailure(state, project, failure),
    setFault: (fault) => setDeployFault(state, fault),
    dashboardRoot: inputs.dashboardRoot,
  });
  function withFreshness(list: SpecTarget[]) {
    return withFreshnessImpl(landCtx, list);
  }
  /** The row's Delete branch: a merged branch its landing left on origin. */
  function deleteLeftBehindBranch(project: string, folder: string) {
    return deleteLeftBehindBranchImpl(landCtx, project, folder);
  }

  return {
    jobRow, landNewSpec, landStepBranch, landStoppedStepBranch, landArchivedSpec, landClosedSpec, landScheduleRun,
    deploy, deployJob, withFreshness, deleteLeftBehindBranch,
  };
}
