// The three contexts `createServer` hands on — the runner's, the spec
// views' and the routes' — each built from the services before it.

import type { Notifier } from "../../integrations/notify.ts";
import type { RoutesContext } from "../routes";
import { DEFAULT_PDF_CACHE_DIR } from "../routes/spec-pdf.ts";
import type { SpecViewsContext } from "../spec-views";
import { answerProjectChange, persistAllowlist as persistAllowlistImpl, type ProjectActionsContext } from "../project-actions.ts";
import type { setupSpecViews } from "../setup/spec-views.ts";
import { setupQueueContext } from "../setup/queue-context.ts";
import { applyOverlapDependencies } from "../dependencies";
import type { RunnerSetupContext, createQueueRunner } from "../runner-setup/index.ts";
import type { Land, Schedules, TestServers, Wiring } from "./services.ts";

export function buildRunnerSetupCtx(
  w: Wiring,
  parts: { schedules: Schedules; land: Land; testServerStore: TestServers["testServerStore"]; notifier: Notifier; readRoutesCtx: () => RoutesContext },
): RunnerSetupContext {
  const { opts, state, resolution } = w;
  const { schedules, land } = parts;
  return {
    store: w.queue, queueConfigFile: opts.queueConfigFile, dashboardCheckoutRoot: opts.dashboardCheckoutRoot, queueMirrorPath: opts.queueMirrorPath,
    machineryProjectDir: resolution.machineryProjectDir,
    machinerySpecsRoot: resolution.machinerySpecsRoot,
    queueRunnerBin: opts.queueRunnerBin,
    queueResultDir: opts.queueResultDir,
    scheduleOutputRoot: opts.scheduleOutputRoot,
    queueConcurrency: opts.queueConcurrency,
    // `state.server` is not set yet — see state.ts's own doc comment.
    readServerPort: () => state.server?.port,
    codeLanding: resolution.codeLanding,
    queuePush: opts.queuePush,
    promptFileFor: resolution.promptFileFor,
    chromeFor: resolution.chromeFor, noSandboxFor: resolution.noSandboxFor,
    notifier: parts.notifier,
    landNewSpec: land.landNewSpec,
    landStepBranch: land.landStepBranch,
    landArchivedSpec: land.landArchivedSpec,
    landClosedSpec: land.landClosedSpec,
    landStoppedStepBranch: land.landStoppedStepBranch,
    handleSharedFiles: (job, outcome) => applyOverlapDependencies(parts.readRoutesCtx(), job, outcome),
    landScheduleRun: land.landScheduleRun,
    startDeploy: land.deployJob.start, startLand: land.landJob.start, testServerStore: parts.testServerStore,
    specDir: resolution.specDir,
    peekMachinerySpecDir: resolution.peekMachinerySpecDir,
    forgetSpecCaches: schedules.forgetSpec, whenSpecsScanned: schedules.whenSpecsScanned,
    // A macrotask, not now: the step's own result is written right
    // after this is asked for, and a read stamped before that write
    // would never count as having seen the step.
    rereadSpecCaches: (dir, folder) => {
      setTimeout(() => void schedules.rereadSpec(dir, folder, { askOrigin: true }).catch(() => {}), 0);
    },
  };
}

export function buildSpecViewsCtx(
  w: Wiring,
  parts: { schedules: Schedules; land: Land; testServersCtx: TestServers["testServersCtx"]; pdfToolAvailable: boolean },
): SpecViewsContext {
  const { state, resolution } = w;
  const { schedules, land } = parts;
  // `readPrOpen`/`readScan` ride as getters because `state.prOpen`/
  // `state.scan` are reassigned after this context is built.
  return {
    projectRoot: w.opts.projectRoot,
    machineryProjectDir: resolution.machineryProjectDir,
    targets: resolution.targets,
    peekUnlanded: resolution.peekUnlanded,
    peekUnlandedCheckedAt: resolution.peekUnlandedCheckedAt,
    peekMergedOnOrigin: resolution.peekMergedOnOrigin,
    readPrOpen: () => state.prOpen,
    readScan: () => state.scan,
    queue: w.queue,
    specDir: resolution.specDir,
    specRef: resolution.specRef,
    peekMachinerySpecDir: resolution.peekMachinerySpecDir,
    machinerySpecDir: resolution.machinerySpecDir,
    gitRun: resolution.gitRun,
    withFreshness: land.withFreshness,
    jobRow: land.jobRow,
    specFileCommits: schedules.specFileCommits,
    branchStatus: resolution.branchStatus,
    specsRoot: resolution.specsRoot,
    specCreatedAt: schedules.specCreatedAt,
    pdfToolAvailable: parts.pdfToolAvailable,
    testServers: parts.testServersCtx,
  };
}

/** What the routes' context is built from, beside the wiring. */
interface RoutesParts {
  nav: Parameters<typeof setupQueueContext>[1]["nav"];
  schedules: Schedules;
  land: Land;
  testServersCtx: TestServers["testServersCtx"];
  runner: ReturnType<typeof createQueueRunner>;
  views: ReturnType<typeof setupSpecViews>;
  pdfToolAvailable: boolean;
}

export function buildRoutesCtx(w: Wiring, parts: RoutesParts): RoutesContext {
  const { opts, resolution, watch } = w;
  const { schedules, land } = parts;
  // `state.server` is not set yet — see state.ts's own doc comment, and
  // `buildRunnerSetupCtx`'s `readServerPort` for the identical shape.
  const currentPort = () => w.state.server?.port ?? opts.port;
  const projectActionsCtx: ProjectActionsContext = { queueConfigFile: opts.queueConfigFile, allowed: w.allowed };
  // Built last, from every earlier stage's own pieces — see
  // `RoutesContext`'s own doc comment for why `scan` rides as a
  // getter/invalidator pair instead of a value.
  return setupQueueContext(w.state, {
    opts,
    nav: parts.nav,
    allowed: w.allowed,
    scheduleStore: w.scheduleStore,
    forgetSpec: schedules.forgetSpec, specProgress: schedules.specProgress,
    rereadSpec: opts.rereadSpec ?? schedules.rereadSpec,
    rereadProject: schedules.rereadProject, specsScanned: schedules.specsScanned, whenSpecsScanned: schedules.whenSpecsScanned,
    targets: resolution.targets,
    withFreshness: land.withFreshness,
    specDir: resolution.specDir,
    specRef: resolution.specRef,
    specsRoot: resolution.specsRoot,
    machinerySpecDir: resolution.machinerySpecDir,
    watchers: watch.watchers,
    phaseWatchers: watch.phaseWatchers,
    writeTo: watch.writeTo,
    queue: w.queue,
    displayProjectDir: resolution.displayProjectDir,
    machineryProjectDir: resolution.machineryProjectDir,
    ownedSpecsRoot: resolution.ownedSpecsRoot,
    ensureCheckout: resolution.ensureCheckout,
    gitRun: resolution.gitRun,
    branchStatus: resolution.branchStatus,
    mergeLock: schedules.mergeLock,
    runner: parts.runner,
    tickRunner: schedules.tickRunner,
    serverPort: currentPort,
    jobRow: land.jobRow,
    deploy: land.deploy,
    deleteLeftBehindBranch: land.deleteLeftBehindBranch,
    persistAllowlist: (what: string) => persistAllowlistImpl(projectActionsCtx, what),
    answerProjectChange,
    ...parts.views,
    pdfCacheDir: opts.pdfCacheDir ?? DEFAULT_PDF_CACHE_DIR,
    pdfGeneratorBin: opts.pdfGeneratorBin ?? "aide-generate-pdf",
    pdfToolAvailable: parts.pdfToolAvailable,
    testServers: parts.testServersCtx,
    push: w.push,
    toolReadings: w.toolReadings,
  });
}
