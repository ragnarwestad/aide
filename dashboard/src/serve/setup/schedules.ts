import { deployUnderWay } from "../../queue/queue.ts";
// The four git-backed checkers and the schedules built on top of them:
// drift, the spec caches, and each project's own `schedule:` entries.
//
// `readRunner` stays a getter reading `state.runner`: the runner stage
// runs AFTER this one (it needs the land functions setup/land.ts
// builds, which in turn want nothing from here but `warmSpec`), so
// `runner` genuinely does not exist yet when this stage runs — only
// when a schedule timer actually fires, long afterwards.

import type { BranchStatusChecker } from "../../git/branch-status.ts";
import type { GitRunner } from "../../git/process/index.ts";
import { DEFAULT_TTL_MS } from "../../git/branch-status.ts";
import {
  DescriptionFreshnessChecker,
  SpecCreatedAtChecker,
  SpecFileCommitChecker,
} from "../../git/description-freshness.ts";
import { WorkflowHistoryChecker, BranchFileStepsChecker } from "../../git/workflow-history.ts";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT, type DashboardCheckout } from "../../git/dashboard-checkout/index.ts";
import { hiddenOf } from "../../project/project-admin/hidden.ts";
import type { CheckoutEnsurer } from "../../git/checkout-ensurer.ts";
import type { GhRunner } from "../../integrations/pull-requests.ts";
import { resolveCodeLanding, resolvePreviewFrom } from "../../project/discover";
import type { QueueStore } from "../../queue/queue.ts";
import type { CheckableTool, SpecTarget } from "../../render";
import {
  refreshDrift as refreshDriftImpl,
  warmSpec as warmSpecImpl,
  rereadProject as rereadProjectImpl,
  forgetSpec as forgetSpecImpl,
  readSpecProgress,
  rereadSpec as rereadSpecImpl,
  refreshSpecCaches as refreshSpecCachesImpl,
  settleSpecCaches as settleSpecCachesImpl,
  refreshSchedules as refreshSchedulesImpl,
  tickRunner as tickRunnerImpl,
  type ScheduleContext,
} from "../schedules";
import { BRANCH_PREVIEW_POLL_MS, dropPreviewsOfRunningSteps, refreshBranchPreviews, type BranchPreviewContext } from "../schedules/branch-previews.ts";
import { keptEntries, readAllUsage, USAGE_POLL_MS, usageReader, type UsageRead } from "../providers/usage-kept.ts";
import { setUsageEntries } from "../../render/ui/usage-dialog/index.ts";
import { setDeployWaiting, type DeployWaiting } from "../../render/ui/deploy-mark/index.ts";
import { deployWaiting } from "../deploy-job/waiting.ts";
import { resolveInstallCmd } from "../../project/discover";
import { runScript } from "../process";
import { createRootLock, SPEC_CACHE_POLL_MS } from "../serve-helpers";
import type { ServerState } from "../state.ts";
import { firstSweepMark } from "../schedules/first-sweep.ts";
import type { ScheduleStore } from "../../queue/schedule-store.ts";
import { cleanupDue, enqueueNightlyCleanup } from "../process-cleanup/schedule.ts";

export interface ScheduleSetupOptions {
  projectRoot?: string;
  /** How GitHub is asked about a pull request; `gh` through `runScript` unless a test supplies one. */
  ghRun?: GhRunner;
  driftPollMs?: number;
  specCachePollMs?: number;
  scheduleCheckMs?: number;
  branchPreviewPollMs?: number;
  cleanupCheckMs?: number;
  usagePollMs?: number;
  usageProbe?: UsageRead;
  checkToolsOnStart?: boolean;
  /** Where the board keeps its checkouts, and each project's `hidden` flag. */
  dashboardCheckoutRoot?: string;
}

export interface ScheduleSetupInputs {
  machineryProjectDir: (project: string) => string;
  branchStatus: BranchStatusChecker;
  targets: () => SpecTarget[];
  allowed: Set<string>;
  scheduleStore: ScheduleStore;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
  queue: QueueStore;
  specRoots: (project: string) => string[];
  checkoutEnsurer: CheckoutEnsurer;
  gitRun: GitRunner;
  notifyQueueChanged: () => void;
  /** Tells every open tab that what the board has to deploy changed. */
  notifyDeployWaiting?: () => void;
  /** The same resolver `LandContext.specsRoot` already gives
   *  `resolveOpenBranchTarget` — what `warmSpec` needs to ask whether a
   *  live spec's own `aide/<folder>` branch is still open. */
  specsRoot: (dir: string) => Promise<string>;
  /** Checks again the tools waiting jobs will run on; absent, nothing is. */
  recheckTools?: (tools: CheckableTool[]) => Promise<void>;
}

/** How often the spec caches are refilled, and how long one answer stands.
 *  The window is never longer than the schedule: a longer one would hand
 *  the schedule its own old answer. It may be shorter, so an
 *  answer an action asks for between two runs is taken afresh. A poll of
 *  `0` turns the schedule off, which is a test seam and not a window — the
 *  checkers keep their own default there, so an answer put in by hand
 *  still stands. */
export function specCacheTimes(pollMs = SPEC_CACHE_POLL_MS): { pollMs: number; ttlMs: number } {
  return { pollMs, ttlMs: pollMs > 0 ? Math.min(pollMs, DEFAULT_TTL_MS) : DEFAULT_TTL_MS };
}

/** `gh` on the PATH a step's own spawn gets, so it is the one the runner
 *  finds. No answer, not an error, where it cannot be run. */
const runGh: GhRunner = (dir, args) =>
  runScript(["gh", ...args], dir, 10_000, undefined, { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" }).catch(
    () => ({ code: 127, stdout: "" }),
  );

/** The git-backed checkers, each sharing the one runner and the spec caches' window. */
function createCheckers(gitRun: GitRunner, specCacheTtlMs: number) {
  // A third user of the same runner: has the description moved on since
  // the plan was written?
  const freshness = new DescriptionFreshnessChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a fourth: which steps this spec has actually had.
  const workflowHistory = new WorkflowHistoryChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // A fifth: when the spec was MADE.
  const specCreatedAt = new SpecCreatedAtChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a sixth: which commit last touched each spec file.
  const specFileCommits = new SpecFileCommitChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a seventh: the file half of the disagreement
  // comparison, read from a spec's own open branch instead of the
  // default-branch checkout's stale copy.
  const branchFileSteps = new BranchFileStepsChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  return { freshness, workflowHistory, specCreatedAt, specFileCommits, branchFileSteps };
}

type Checkers = ReturnType<typeof createCheckers>;
type SpecsMark = ReturnType<typeof firstSweepMark>;

function scheduleContext(
  opts: ScheduleSetupOptions,
  state: ServerState,
  inputs: ScheduleSetupInputs,
  checkers: Checkers,
  specsMark: SpecsMark,
): ScheduleContext {
  const { machineryProjectDir } = inputs;
  return {
    projectRoot: opts.projectRoot,
    machineryProjectDir,
    scheduleStore: inputs.scheduleStore,
    branchStatus: inputs.branchStatus,
    readWorkflowHistory: () => checkers.workflowHistory,
    readFreshness: () => checkers.freshness,
    readSpecCreatedAt: () => checkers.specCreatedAt,
    readSpecFileCommits: () => checkers.specFileCommits,
    specsRoot: inputs.specsRoot,
    readBranchFileSteps: () => checkers.branchFileSteps,
    targets: inputs.targets,
    readScan: () => state.scan,
    invalidateScan: () => {
      state.scan = null;
    },
    allowed: inputs.allowed,
    ensureCheckout: inputs.ensureCheckout,
    queue: inputs.queue,
    specRoots: inputs.specRoots,
    readRunner: () => state.runner,
    checkoutEnsurer: inputs.checkoutEnsurer,
    notifyQueueChanged: inputs.notifyQueueChanged,
    recheckTools: inputs.recheckTools,
    codeLanding: (project) => resolveCodeLanding(machineryProjectDir(project)),
    ghRun: opts.ghRun ?? runGh,
    pullRequests: state.pullRequests,
    specsScanned: specsMark.scanned,
    markSpecsScanned: specsMark.mark,
  };
}

/** Whether a branch has been built by its host is asked about on its own
 *  schedule, not with the spec caches: the answer changes within
 *  minutes of a push, and each question is a call to GitHub. */
function branchPreviewContext(opts: ScheduleSetupOptions, state: ServerState, inputs: ScheduleSetupInputs): BranchPreviewContext {
  const { machineryProjectDir, queue } = inputs;
  return {
    targets: inputs.targets,
    machineryProjectDir,
    branchStatus: inputs.branchStatus,
    previewFrom: (project) => resolvePreviewFrom(machineryProjectDir(project)),
    stepRunning: (project, specFolder) =>
      queue.list().some((j) => j.project === project && j.specFolder === specFolder && j.state === "running"),
    ghRun: opts.ghRun ?? runGh,
    branchPreviews: state.branchPreviews,
    notifyQueueChanged: inputs.notifyQueueChanged,
  };
}

/** The drift refresh, and what the header's Deploy mark shows: asked after
 *  each fetch of origin, so a page render only reads it. */
function createDriftRefresh(state: ServerState, inputs: ScheduleSetupInputs, scheduleCtx: ScheduleContext) {
  const { allowed, machineryProjectDir, branchStatus, gitRun } = inputs;
  let waiting: DeployWaiting | undefined;
  setDeployWaiting(() => (state.stopped || !waiting ? undefined : { ...waiting, underWay: deployUnderWay(inputs.queue.list(), waiting.project) }));
  return async function refreshDrift() {
    await refreshDriftImpl(scheduleCtx);
    const before = waiting;
    waiting = await deployWaiting({
      projects: [...allowed],
      projectDir: machineryProjectDir,
      serving: { sha: state.servingSha, repoRoot: state.servingRepoRoot },
      canDeploy: (root) => !!resolveInstallCmd(root).value,
      reachedOrigin: (root) => branchStatus.reachedOrigin(root),
      defaultBranch: (root) => branchStatus.defaultBranch(root),
      run: gitRun,
    }).catch(() => undefined);
    if (before?.project !== waiting?.project || before?.commits !== waiting?.commits) inputs.notifyDeployWaiting?.();
  };
}

/** The schedule functions the other stages call, each bound to the one context. */
function scheduleFunctions(scheduleCtx: ScheduleContext, branchPreviewCtx: BranchPreviewContext) {
  function warmSpec(t: { dir?: string; specFolder: string; reopenedAfter?: string }) {
    return warmSpecImpl(scheduleCtx, t);
  }
  function rereadSpec(dir: string, specFolder: string, opts?: { askOrigin?: boolean }) {
    return rereadSpecImpl(scheduleCtx, dir, specFolder, opts);
  }
  function rereadProject(project: string) {
    return rereadProjectImpl(scheduleCtx, project);
  }
  function forgetSpec(dir: string, specFolder: string) {
    forgetSpecImpl(scheduleCtx, dir, specFolder);
  }
  function specProgress(dir: string, specFolder: string) {
    return readSpecProgress(scheduleCtx, dir, specFolder);
  }
  function refreshSpecCaches() {
    return refreshSpecCachesImpl(scheduleCtx);
  }
  function settleSpecCaches() {
    return settleSpecCachesImpl(scheduleCtx);
  }
  function refreshSchedules() {
    return refreshSchedulesImpl(scheduleCtx);
  }
  function tickRunner() {
    dropPreviewsOfRunningSteps(branchPreviewCtx);
    return tickRunnerImpl(scheduleCtx);
  }
  return { warmSpec, rereadSpec, rereadProject, forgetSpec, specProgress, refreshSpecCaches, settleSpecCaches, refreshSchedules, tickRunner };
}

/** Runs `round` now and then every `ms`; no timer at all when `ms` is 0.
 *  `.unref()`'d and cleared in `stop()` — `bun test` runs many suites
 *  in one process, and a timer from a stopped test's server would go
 *  on firing into the next one. */
function repeatNow(ms: number, round: () => void): ReturnType<typeof setInterval> | null {
  if (ms <= 0) return null;
  round();
  const timer = setInterval(round, ms);
  timer?.unref?.();
  return timer;
}

/** The four refresh schedules, in the order they first run. */
function startRefreshTimers(
  opts: ScheduleSetupOptions,
  specCachePollMs: number,
  refreshDrift: () => Promise<void>,
  fns: ReturnType<typeof scheduleFunctions>,
  branchPreviewCtx: BranchPreviewContext,
) {
  // The checker's own TTL by default: the window the answer was already
  // considered current for is the window worth re-taking it in.
  const driftPollMs = opts.driftPollMs ?? DEFAULT_TTL_MS;
  const driftTimer = repeatNow(driftPollMs, () => void refreshDrift());
  const specCacheTimer = repeatNow(specCachePollMs, () => void fns.refreshSpecCaches());
  /** Does any project's own `schedule:` entry have a fire due
   *  right now, and if so enqueue it. A SCHEDULE, not a cache window,
   *  like `driftPollMs` and `specCachePollMs`. */
  const scheduleCheckMs = opts.scheduleCheckMs ?? DEFAULT_TTL_MS;
  const scheduleTimer = repeatNow(scheduleCheckMs, () => void fns.refreshSchedules());
  const branchPreviewPollMs = opts.branchPreviewPollMs ?? BRANCH_PREVIEW_POLL_MS;
  const branchPreviewTimer = repeatNow(branchPreviewPollMs, () => void refreshBranchPreviews(branchPreviewCtx));
  return [driftTimer, specCacheTimer, scheduleTimer, branchPreviewTimer];
}

/** The nightly clean-up check, and the providers' usage readings. */
function startHousekeepingTimers(opts: ScheduleSetupOptions, state: ServerState, inputs: ScheduleSetupInputs, tickRunner: () => unknown) {
  const { queue, allowed } = inputs;
  const cleanupCheckMs = opts.cleanupCheckMs ?? 60_000;
  const cleanupTimer = cleanupCheckMs > 0 ? setInterval(() => {
    const now = new Date();
    if (cleanupDue(now) && enqueueNightlyCleanup(queue, allowed, now, hiddenOf(opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT, allowed))) {
      void tickRunner();
    }
  }, cleanupCheckMs) : null;
  cleanupTimer?.unref?.();

  // Every Claude Code and Codex provider's usage, read now and then on the
  // interval, so no page waits for a tool. Only a server with something to
  // read with reads, and only such a server's pages carry the readings.
  const usageRead = usageReader(opts);
  const usagePollMs = opts.usagePollMs ?? USAGE_POLL_MS;
  const usageTimer = usageRead
    ? repeatNow(usagePollMs, () => void readAllUsage(opts, queue.defaults.providers ?? {}, usageRead))
    : null;
  // Set by every server, a server with nothing to read with included, so one
  // server's readings never stay in the header of the next.
  setUsageEntries(usageRead ? () => (state.stopped ? undefined : keptEntries(opts, queue.defaults.providers ?? {})) : undefined);
  return [cleanupTimer, usageTimer];
}

export function setupSchedules(opts: ScheduleSetupOptions, state: ServerState, inputs: ScheduleSetupInputs) {
  const { pollMs: specCachePollMs, ttlMs: specCacheTtlMs } = specCacheTimes(opts.specCachePollMs);

  // One merge at a time per repo. Every spec shares the specs root, and
  // two specs in one project share that repo too, so two presses a few
  // milliseconds apart were two git sequences in one working tree.
  const mergeLock = createRootLock();
  const checkers = createCheckers(inputs.gitRun, specCacheTtlMs);

  // Kept per server, not per module: `bun test` runs many boards in one process.
  // Once set, open pages are told, so a Jobs list drawn before it drops the specs
  // that turned out to have no work.
  const specsMark = firstSweepMark(inputs.notifyQueueChanged);

  const scheduleCtx = scheduleContext(opts, state, inputs, checkers, specsMark);
  const branchPreviewCtx = branchPreviewContext(opts, state, inputs);
  const refreshDrift = createDriftRefresh(state, inputs, scheduleCtx);
  const fns = scheduleFunctions(scheduleCtx, branchPreviewCtx);

  const refreshTimers = startRefreshTimers(opts, specCachePollMs, refreshDrift, fns, branchPreviewCtx);
  const housekeepingTimers = startHousekeepingTimers(opts, state, inputs, fns.tickRunner);

  const { warmSpec, rereadSpec, rereadProject, forgetSpec, specProgress, refreshSpecCaches, settleSpecCaches, tickRunner } = fns;
  return {
    mergeLock, ...checkers,
    warmSpec, rereadSpec, rereadProject, forgetSpec, specProgress, refreshSpecCaches, settleSpecCaches, tickRunner,
    specsScanned: specsMark.scanned, whenSpecsScanned: specsMark.whenScanned,
    timers: [...refreshTimers, ...housekeepingTimers],
  };
}
