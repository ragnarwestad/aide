// The services `createServer` builds before the runner, one function
// each, called in the order the server creates them: later ones read the
// pieces earlier ones returned, which `Wiring` carries.

import { resolve, dirname } from "node:path";
import { conflictRepairSession } from "../land-branch/repair/conflict.ts";
import { createLandingGate } from "../land-branch/repair/index.ts";
import { toolRechecker, type ToolReadings } from "../tool-check.ts";
import { assignSpecNumberAfterMerge } from "../land-branch/finalize-create.ts";
import { translationMergeArgs } from "../land-branch/run-script.ts";
import type { AideRunStore } from "../../queue/aide-run-store.ts";
import { QueueStore, type ProjectResolver } from "../../queue/queue.ts";
import type { ScheduleStore } from "../../queue/schedule-store.ts";
import type { Push } from "../../push";
import { QUEUE_DEFAULTS } from "../serve-helpers";
import type { ServerOptions } from "../options.ts";
import { DEFAULT_BIND_HOST, isLoopbackBind } from "../queue-guard.ts";
import type { ServerState } from "../state.ts";
import type { WatchSetup } from "../setup/watch.ts";
import { setupPush } from "../setup/push.ts";
import type { setupProjectResolution } from "../setup/project-resolution.ts";
import { setupSchedules } from "../setup/schedules.ts";
import { setupLand } from "../setup/land.ts";
import { setupTestServers } from "../setup/test-servers.ts";
import { createLaunchdRestart } from "../deployment";

export type Resolution = ReturnType<typeof setupProjectResolution>;
export type Schedules = ReturnType<typeof setupSchedules>;
export type Land = ReturnType<typeof setupLand>;
export type TestServers = ReturnType<typeof setupTestServers>;

/** What every stage after the queue reads: the options and the services
 *  built before it. */
export interface Wiring {
  opts: ServerOptions;
  state: ServerState;
  store: AideRunStore;
  allowed: Set<string>;
  scheduleStore: ScheduleStore;
  resolution: Resolution;
  watch: WatchSetup;
  queue: QueueStore;
  push: Push;
  /** This server's own tool checks and model readings. */
  toolReadings: ToolReadings;
}

/** The folder Aide's scripts are run from: beside the runner this server
 *  was started with, when one is configured. */
export function runnerScriptDir(opts: ServerOptions): string | undefined {
  return opts.queueRunnerBin ? dirname(opts.queueRunnerBin) : undefined;
}

export function assertHeaderAuthOnLoopback(opts: ServerOptions): void {
  // A header this process trusts is only trustworthy because
  // nothing OTHER than the proxy in front of it can reach the port
  // carrying it. Checked once, here, before anything else runs and
  // before `Bun.serve()` binds a socket — an unconditional throw, not a
  // per-request branch that a future new route could forget to add.
  if (!opts.headerAuth || isLoopbackBind(opts.bindHost)) return;
  throw new Error(
    `headerAuth names "${opts.headerAuth.header}" but the server binds ` +
      `${opts.bindHost ?? DEFAULT_BIND_HOST}, not loopback — a header from anywhere ` +
      "else can be forged by anyone who can reach this port. Bind to " +
      "127.0.0.1 (or ::1), or remove headerAuth from the queue config.",
  );
}

export function pdfToolIsAvailable(opts: ServerOptions): boolean {
  // `Bun.which` is synchronous, unlike `servingSha`'s check
  // in `readServingCommit`, so this needs no `state.ts` field — a plain
  // const, computed once and captured by value in both contexts built
  // later. `pdfToolAvailable` is overridable (the same shape
  // `runnerAvailable` already is): no test should depend on `md-to-pdf`
  // actually being installed on the machine running `bun test`.
  return opts.pdfToolAvailable ?? !!Bun.which("md-to-pdf");
}

export function readServingCommit(state: ServerState, gitRun: Resolution["gitRun"]): void {
  // This process's own commit, read once — see state.ts's
  // own doc comment for why both fields start and stay `null` until
  // this resolves. `servingRepoRoot` is the repo this process runs
  // from, used to tell "the project whose checkout I am" from every
  // other one.
  Promise.all([
    gitRun(process.cwd(), ["rev-parse", "HEAD"]),
    gitRun(process.cwd(), ["rev-parse", "--show-toplevel"]),
  ])
    .then(([sha, top]) => {
      if (sha.code === 0) state.servingSha = sha.stdout.trim();
      if (top.code === 0) state.servingRepoRoot = top.stdout.trim();
    })
    // A `gitRun` that throws rather than answering with a nonzero code
    // (no git on the machine at all) must leave both `null`, the same
    // fail-open answer a nonzero code produces — not an unhandled
    // rejection that takes the server down.
    .catch(() => {});
}

export function createQueueWithPush(
  opts: ServerOptions,
  inputs: { allowed: Set<string>; resolveProject: ProjectResolver; watch: WatchSetup; scheduleStore: ScheduleStore; targets: Resolution["targets"] },
): { push: Push; queue: QueueStore } {
  const { allowed, watch } = inputs;
  // Built after `resolveProject`, which it takes. Nothing above it reads
  // it any more: `targets` used to ask the queue what it had run, and
  // the spec's own files are the only answer to that now.
  const push = setupPush(opts, { jobs: () => queue.list(), notify: () => watch.notifyQueueChanged(), scheduleStore: inputs.scheduleStore, served: allowed, targets: inputs.targets, groups: () => queue.executionGroups.list() });
  const queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    executionGroupsPath: opts.executionGroupsPath,
    pendingModelsPath: opts.pendingModelsPath, modelIdsPath: opts.modelIdsPath,
    pendingStepsPath: opts.pendingStepsPath,
    defaults: opts.queueDefaults ?? structuredClone(QUEUE_DEFAULTS),
    resolve: inputs.resolveProject,
    allowCreateProject: (project) => allowed.has(project),
    onChange: () => {
      watch.notifyQueueChanged();
      push.observe();
    },
  });
  return { push, queue };
}

export function wireSchedules(w: Wiring): Schedules {
  const { opts, resolution, queue } = w;
  const schedules = setupSchedules(opts, w.state, {
    machineryProjectDir: resolution.machineryProjectDir,
    branchStatus: resolution.branchStatus,
    targets: resolution.targets,
    allowed: w.allowed,
    scheduleStore: w.scheduleStore,
    ensureCheckout: resolution.ensureCheckout,
    queue,
    specRoots: resolution.specRoots,
    checkoutEnsurer: resolution.checkoutEnsurer,
    gitRun: resolution.gitRun,
    notifyQueueChanged: w.watch.notifyQueueChanged,
    notifyDeployWaiting: w.watch.notifyDeployWaiting,
    specsRoot: resolution.specsRoot,
    // Behind the same one flag as the check at start-up: a server nobody
    // asked to check anything never spawns a CLI to do it.
    recheckTools: opts.checkToolsOnStart ? toolRechecker(w.toolReadings, { providers: () => queue.defaults.providers, scriptDir: runnerScriptDir(opts) }) : undefined,
  });
  resolution.attachBranchFileSteps(schedules.branchFileSteps);
  return schedules;
}

export function wireTestServers(w: Wiring): TestServers {
  const { opts } = w;
  return setupTestServers(w.state, {
    testServersPath: opts.testServersPath,
    machineryProjectDir: w.resolution.machineryProjectDir,
    gitRun: w.resolution.gitRun,
    testServersAvailable: opts.testServersAvailable,
    testServersSpawn: opts.testServersSpawn,
    testServersIsAlive: opts.testServersIsAlive,
    testServersPortProbe: opts.testServersPortProbe,
    testServersOnPort: opts.testServersOnPort,
    testServersPortExposed: opts.testServersPortExposed,
    port: opts.port,
  });
}

export function wireLand(w: Wiring, schedules: Schedules, testServersCtx: TestServers["testServersCtx"]): Land {
  const { opts, resolution, queue } = w;
  const scriptDir = runnerScriptDir(opts);
  return setupLand(w.state, {
    machineryProjectDir: resolution.machineryProjectDir,
    displayProjectDir: resolution.displayProjectDir,
    codeLanding: resolution.codeLanding,
    queue,
    store: w.store,
    mergeLock: schedules.mergeLock,
    gitRun: resolution.gitRun,
    branchStatus: resolution.branchStatus,
    warmSpec: schedules.warmSpec,
    machinerySpecsRoot: resolution.machinerySpecsRoot,
    specsRoot: resolution.specsRoot,
    workflowHistory: schedules.workflowHistory,
    specCreatedAt: schedules.specCreatedAt,
    freshness: schedules.freshness,
    branchFileSteps: schedules.branchFileSteps,
    forgetSpec: schedules.forgetSpec,
    rootsStillHolding: resolution.rootsStillHolding,
    queueInstallTimeoutMs: opts.queueInstallTimeoutMs,
    restart: opts.restart ?? createLaunchdRestart(),
    restartPollMs: opts.restartPollMs,
    restartDeferTimeoutMs: opts.restartDeferTimeoutMs,
    dashboardRoot: opts.dashboardRoot ?? resolve(import.meta.dir, "..", "..", "..", ".."),
    conflictRepair: (work, job, branch, base, files) => conflictRepairSession(queue.defaults, job, () => queue.get(job.id)?.state === "cancelled")({ work, branch, base, files }),
    landingGate: opts.landingGate ?? createLandingGate(queue, scriptDir, opts.queueMirrorPath),
    // The script that numbers a landed create lives beside the runner
    // this server was started with, so a board serving a branch numbers
    // with that branch's own copy.
    finalizeCreateSpec:
      opts.finalizeCreateSpec ??
      ((work, root, specs, folder) => assignSpecNumberAfterMerge(work, root, specs, folder, { scriptDir })),
    translationMergeArgs: (root, work) => translationMergeArgs(root, work, { scriptDir }),
    testServers: testServersCtx,
  });
}
