// The final assembly: every earlier stage's own pieces, gathered into
// the one context `handleQueue` reads. Split out of serve.ts (split
// serve.ts by theme, restructuring createServer into staged setup
// functions to get it under 500 lines) — built last, since it is the
// one stage that reads every other one.

import type { BranchFileStepsChecker } from "../git/workflow-history.ts";
import { setPendingRestart, type ServerState } from "./state.ts";
import { type HandleQueueContext } from "./handle-queue.ts";

/** Everything `HandleQueueContext` needs, minus the handful of fields
 *  this stage builds itself off `state` and `branchFileSteps` — the
 *  same "the getters live here, the values arrive from every earlier
 *  stage" split `HandleQueueContext`'s own doc comment already
 *  describes for `readScan`/`invalidateScan`. */
export type QueueContextInputs = Omit<
  HandleQueueContext,
  "readScan" | "invalidateScan" | "forgetBranchFileSteps" | "readServing" | "readPendingRestart" | "setPendingRestart" | "selfStopExit"
> & {
  branchFileSteps: BranchFileStepsChecker;
};

export function setupQueueContext(state: ServerState, inputs: QueueContextInputs): HandleQueueContext {
  return {
    opts: inputs.opts,
    nav: inputs.nav,
    allowed: inputs.allowed,
    readScan: () => state.scan,
    invalidateScan: () => {
      state.scan = null;
    },
    forgetBranchFileSteps: (dir, specFolder) => inputs.branchFileSteps.forget(dir, specFolder),
    targets: inputs.targets,
    withFreshness: inputs.withFreshness,
    specDir: inputs.specDir,
    specRef: inputs.specRef,
    specsRoot: inputs.specsRoot,
    machinerySpecDir: inputs.machinerySpecDir,
    watchers: inputs.watchers,
    writeTo: inputs.writeTo,
    queue: inputs.queue,
    displayProjectDir: inputs.displayProjectDir,
    machineryProjectDir: inputs.machineryProjectDir,
    ownedSpecsRoot: inputs.ownedSpecsRoot,
    ensureCheckout: inputs.ensureCheckout,
    gitRun: inputs.gitRun,
    branchStatus: inputs.branchStatus,
    mergeLock: inputs.mergeLock,
    runner: inputs.runner,
    tickRunner: inputs.tickRunner,
    queueToken: inputs.queueToken,
    serverPort: inputs.serverPort,
    jobRow: inputs.jobRow,
    installAfterMerge: inputs.installAfterMerge,
    persistAllowlist: inputs.persistAllowlist,
    answerProjectChange: inputs.answerProjectChange,
    archivedSpecRows: inputs.archivedSpecRows,
    specPageView: inputs.specPageView,
    jobDetailView: inputs.jobDetailView,
    readServing: () => ({ sha: state.servingSha, repoRoot: state.servingRepoRoot }),
    readPendingRestart: () => state.pendingRestart,
    setPendingRestart: (jobs) => setPendingRestart(state, jobs),
    pdfCacheDir: inputs.pdfCacheDir,
    pdfGeneratorBin: inputs.pdfGeneratorBin,
    pdfToolAvailable: inputs.pdfToolAvailable,
    boards: inputs.boards,
    // Spec 424: never a bare `process.exit()` in the route itself — a
    // test posting to `/api/self-stop` must not end the `bun test`
    // runner it is running inside.
    selfStopExit: inputs.opts.selfStopExit ?? (() => process.exit(0)),
  };
}
