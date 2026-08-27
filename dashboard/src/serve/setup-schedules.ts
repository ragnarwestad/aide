// The four git-backed checkers and the schedules built on top of them:
// drift, the spec caches, and each project's own `schedule:` entries.
//
// `readRunner` stays a getter reading `state.runner`: the runner stage
// runs AFTER this one (it needs the land functions setup-land.ts
// builds, which in turn want nothing from here but `warmSpec`), so
// `runner` genuinely does not exist yet when this stage runs — only
// when a schedule timer actually fires, long afterwards.

import type { BranchStatusChecker, GitRunner } from "../git/branch-status.ts";
import { DEFAULT_TTL_MS } from "../git/branch-status.ts";
import {
  DescriptionFreshnessChecker,
  SpecCreatedAtChecker,
  SpecFileCommitChecker,
} from "../git/description-freshness.ts";
import { WorkflowHistoryChecker } from "../git/workflow-history.ts";
import type { CheckoutEnsurer, DashboardCheckout } from "../git/dashboard-checkout.ts";
import type { QueueStore } from "../queue/queue.ts";
import type { QueueTarget } from "../render.ts";
import {
  refreshDrift as refreshDriftImpl,
  warmSpec as warmSpecImpl,
  refreshSpecCaches as refreshSpecCachesImpl,
  refreshSchedules as refreshSchedulesImpl,
  tickRunner as tickRunnerImpl,
  type ScheduleContext,
} from "./schedules.ts";
import { createRootLock } from "./serve-helpers.ts";
import type { ServerState } from "./state.ts";

export interface ScheduleSetupOptions {
  projectRoot?: string;
  driftPollMs?: number;
  specCachePollMs?: number;
  scheduleCheckMs?: number;
}

export interface ScheduleSetupInputs {
  machineryProjectDir: (project: string) => string;
  branchStatus: BranchStatusChecker;
  targets: () => QueueTarget[];
  allowed: Set<string>;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
  queue: QueueStore;
  specRoots: (project: string) => string[];
  checkoutEnsurer: CheckoutEnsurer;
  gitRun: GitRunner;
}

export function setupSchedules(opts: ScheduleSetupOptions, state: ServerState, inputs: ScheduleSetupInputs) {
  const { machineryProjectDir, branchStatus, targets, allowed, ensureCheckout, queue, specRoots, checkoutEnsurer, gitRun } = inputs;

  // How long ONE spec answer stands, and how often it is retaken, are
  // the same number since spec 208 — because nothing but the schedule
  // takes them any more. `0` means the schedule is OFF, which is a test
  // seam and not a window — the checkers keep their own default there,
  // so an answer put in by hand still stands.
  const specCachePollMs = opts.specCachePollMs ?? DEFAULT_TTL_MS;
  const specCacheTtlMs = specCachePollMs > 0 ? specCachePollMs : DEFAULT_TTL_MS;

  // One merge at a time per repo. Every spec shares the specs root, and
  // two specs in one project share that repo too, so two presses a few
  // milliseconds apart were two git sequences in one working tree.
  const mergeLock = createRootLock();
  // A third user of the same runner: has the description moved on since
  // the plan was written?
  const freshness = new DescriptionFreshnessChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a fourth: which steps this spec has actually had (spec 154).
  const workflowHistory = new WorkflowHistoryChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // A fifth: when the spec was MADE (spec 199).
  const specCreatedAt = new SpecCreatedAtChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a sixth (spec 208): which commit last touched each spec file.
  const specFileCommits = new SpecFileCommitChecker({ run: gitRun, ttlMs: specCacheTtlMs });

  const scheduleCtx: ScheduleContext = {
    projectRoot: opts.projectRoot,
    machineryProjectDir,
    branchStatus,
    readWorkflowHistory: () => workflowHistory,
    readFreshness: () => freshness,
    readSpecCreatedAt: () => specCreatedAt,
    readSpecFileCommits: () => specFileCommits,
    targets,
    readScan: () => state.scan,
    allowed,
    ensureCheckout,
    getWarming: () => state.warming,
    setWarming: (v) => {
      state.warming = v;
    },
    queue,
    specRoots,
    readRunner: () => state.runner,
    checkoutEnsurer,
  };
  function refreshDrift() {
    return refreshDriftImpl(scheduleCtx);
  }
  function warmSpec(t: { dir?: string; specFolder: string; reopenedAfter?: string }) {
    return warmSpecImpl(scheduleCtx, t);
  }
  function refreshSpecCaches() {
    return refreshSpecCachesImpl(scheduleCtx);
  }
  function refreshSchedules() {
    return refreshSchedulesImpl(scheduleCtx);
  }
  function tickRunner() {
    return tickRunnerImpl(scheduleCtx);
  }

  // The checker's own TTL by default: the window the answer was already
  // considered current for is the window worth re-taking it in.
  const driftPollMs = opts.driftPollMs ?? DEFAULT_TTL_MS;
  // `.unref()`'d and cleared in `stop()` — `bun test` runs many suites
  // in one process, and a timer from a stopped test's server would go
  // on firing into the next one.
  const driftTimer =
    driftPollMs > 0
      ? (() => {
          void refreshDrift();
          return setInterval(() => void refreshDrift(), driftPollMs);
        })()
      : null;
  driftTimer?.unref?.();

  const specCacheTimer =
    specCachePollMs > 0
      ? (() => {
          void refreshSpecCaches();
          return setInterval(() => void refreshSpecCaches(), specCachePollMs);
        })()
      : null;
  specCacheTimer?.unref?.();

  /** Spec 259: does any project's own `schedule:` entry have a fire due
   *  right now, and if so enqueue it. A SCHEDULE, not a cache window,
   *  like `driftPollMs` and `specCachePollMs`. */
  const scheduleCheckMs = opts.scheduleCheckMs ?? DEFAULT_TTL_MS;
  const scheduleTimer =
    scheduleCheckMs > 0
      ? (() => {
          void refreshSchedules();
          return setInterval(() => void refreshSchedules(), scheduleCheckMs);
        })()
      : null;
  scheduleTimer?.unref?.();

  return {
    mergeLock, freshness, workflowHistory, specCreatedAt, specFileCommits,
    refreshDrift, warmSpec, refreshSpecCaches, refreshSchedules, tickRunner,
    driftTimer, specCacheTimer, scheduleTimer,
  };
}
