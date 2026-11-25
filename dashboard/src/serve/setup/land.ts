import { waitForDeploy } from "../deploy-job/landing-hold.ts";
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

import { DEFAULT_TTL_MS, LS_REMOTE_NO_MATCH, lsRemoteBranch } from "../../git/branch-status.ts";
import type { AideRunStore } from "../../queue/aide-run-store.ts";
import type { Job, WorkflowStep } from "../../queue/queue.ts";
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
import { createLandJob } from "../land-job/index.ts";

/** What the land setup is given: the landing context's own fields, as
 *  `LandContext` types them, and what only the setup reads. */
export interface LandSetupInputs extends Pick<LandContext,
  | "machineryProjectDir" | "codeLanding" | "queue" | "mergeLock" | "gitRun" | "branchStatus"
  | "warmSpec" | "machinerySpecsRoot" | "specsRoot" | "workflowHistory" | "specCreatedAt"
  | "freshness" | "branchFileSteps" | "forgetSpec" | "rootsStillHolding" | "queueInstallTimeoutMs"
  | "dashboardRoot" | "landingGate" | "conflictRepair" | "finalizeCreateSpec" | "translationMergeArgs"
  | "testServers"> {
  displayProjectDir: (project: string) => string;
  store: AideRunStore;
  restart: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
}

/** A job's row, with the two questions it asks of git kept from being asked too often. */
function createJobRow(inputs: LandSetupInputs) {
  const targets = new Map<string, Promise<string | null>>();
  function mergeTarget(project: string): Promise<string | null> {
    const existing = targets.get(project);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => inputs.branchStatus.defaultBranch(inputs.machineryProjectDir(project)))
      .catch(() => null).finally(() => { if (targets.get(project) === pending) targets.delete(project); });
    targets.set(project, pending);
    return pending;
  }
  // Whether a failed Merge's branch has left origin, asked at most once
  // every 30 seconds per branch: a page draws the row often.
  const gone = new Map<string, { at: number; answer: Promise<boolean | undefined> }>();
  function branchGone(project: string, branch: string): Promise<boolean | undefined> {
    const key = JSON.stringify([project, branch]);
    const hit = gone.get(key);
    if (hit && Date.now() - hit.at < DEFAULT_TTL_MS) return hit.answer;
    const answer = inputs.gitRun(inputs.machineryProjectDir(project), lsRemoteBranch(branch))
      .then((found) => found.code === LS_REMOTE_NO_MATCH ? true : found.code === 0 ? false : undefined)
      .catch(() => undefined);
    gone.set(key, { at: Date.now(), answer });
    return answer;
  }
  const jobRowCtx: JobRowContext = {
    queue: inputs.queue,
    store: inputs.store,
    mergeTarget,
    branchGone,
  };
  return function jobRow(job: Job) {
    return jobRowImpl(jobRowCtx, job);
  };
}

// Built once, from the same locals landBranch and its helpers in
// land-branch.ts used to close over directly — `invalidateScan` is
// the same getter/invalidator shape the queue and SSE contexts use,
// closing over the same `state.scan`.
function landContext(state: ServerState, inputs: LandSetupInputs): LandContext {
  return {
    beforeLanding: (job) => waitForDeploy(inputs.queue, job.id),
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
    conflictRepair: inputs.conflictRepair,
    finalizeCreateSpec: inputs.finalizeCreateSpec,
    translationMergeArgs: inputs.translationMergeArgs,
    testServers: inputs.testServers,
  };
}

/** The landing functions the runner and the routes call, each bound to the one context. */
function landFunctions(landCtx: LandContext) {
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
  function withFreshness(list: SpecTarget[]) {
    return withFreshnessImpl(landCtx, list);
  }
  /** The row's Delete branch: a merged branch its landing left on origin. */
  function deleteLeftBehindBranch(project: string, folder: string) {
    return deleteLeftBehindBranchImpl(landCtx, project, folder);
  }
  return {
    landNewSpec, landStepBranch, landStoppedStepBranch, landArchivedSpec, landClosedSpec, landScheduleRun,
    withFreshness, deleteLeftBehindBranch,
  };
}

/** What the deploy routes and the deploy job ask of the landing code:
 *  the install, the restart check and the restart itself. */
function deployHooks(state: ServerState, inputs: LandSetupInputs, landCtx: LandContext): DeployHooks {
  return {
    installCheckout: (root) => installCheckout(root, inputs.queueInstallTimeoutMs),
    restartRegistered: () => inputs.restart.registered(),
    isBoard: (root) => isDashboardRoot(landCtx, root),
    // The deploy job's restart waits as long as landings take: nothing may
    // be cut short, so no deadline.
    restartWhenSettled: ({ onWait, beforeFire, prepare, cancelled, landings }) =>
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
        beforeFire, prepare, cancelled, landings,
      }),
  };
}

/** The board's own deploy as a job: the runner starts it through
 *  `start`, and the next process finishes it at boot. */
function deployJobFor(state: ServerState, inputs: LandSetupInputs, deploy: DeployHooks) {
  return createDeployJob({
    queue: inputs.queue,
    projectRoot: inputs.machineryProjectDir,
    isBoard: deploy.isBoard,
    gitRun: inputs.gitRun,
    branchStatus: inputs.branchStatus,
    mergeLock: inputs.mergeLock,
    installCheckout: deploy.installCheckout,
    restartRegistered: deploy.restartRegistered,
    restartWhenSettled: deploy.restartWhenSettled,
    waiting: (jobs) => setPendingRestart(state, jobs),
    readServing: () => ({ sha: state.servingSha, repoRoot: state.servingRepoRoot }),
    setFailure: (project, failure) => setDeployFailure(state, project, failure),
    setFault: (fault) => setDeployFault(state, fault),
    dashboardRoot: inputs.dashboardRoot,
  });
}

export function setupLand(state: ServerState, inputs: LandSetupInputs) {
  const jobRow = createJobRow(inputs);
  const landCtx = landContext(state, inputs);
  const lands = landFunctions(landCtx);
  const deploy = deployHooks(state, inputs, landCtx);
  const deployJob = deployJobFor(state, inputs, deploy);
  const landJob = createLandJob(landCtx);

  return {
    jobRow, landNewSpec: lands.landNewSpec, landStepBranch: lands.landStepBranch,
    landStoppedStepBranch: lands.landStoppedStepBranch, landArchivedSpec: lands.landArchivedSpec,
    landClosedSpec: lands.landClosedSpec, landScheduleRun: lands.landScheduleRun,
    deploy, deployJob, landJob, withFreshness: lands.withFreshness, deleteLeftBehindBranch: lands.deleteLeftBehindBranch,
  };
}
