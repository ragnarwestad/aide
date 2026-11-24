// A settled read: a read of the spec caches that reflects what is on disk
// now. It waits for the refresh already running, drops the list's scan and
// reads again — the caller only awaits it.
//
// The single-flight rule itself (a tick that has not finished is not joined
// by the next one) is proven on a running server in `cache-warmer.test.ts`.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker } from "../../../src/git/branch-status.ts";
import { refreshSpecCaches, settleSpecCaches, type ScheduleContext } from "../../../src/serve/schedules";
import { createScheduleStore } from "../../../src/queue/schedule-store.ts";
import type { QueueStore } from "../../../src/queue/queue.ts";
import type { CheckoutEnsurer } from "../../../src/git/checkout-ensurer.ts";
import type { WorkflowHistoryChecker, BranchFileStepsChecker } from "../../../src/git/workflow-history.ts";
import type {
  DescriptionFreshnessChecker, SpecCreatedAtChecker, SpecFileCommitChecker,
} from "../../../src/git/description-freshness.ts";

/** A context whose every sweep asks `ensureCheckout` once, for its one
 *  project. While `holding` is set, that call waits until the test calls
 *  `release()`; otherwise it answers at once. */
function heldCtx() {
  let sweeps = 0;
  let invalidations = 0;
  const held: (() => void)[] = [];
  const control = { holding: true };
  const ctx: ScheduleContext = {
    projectRoot: undefined,
    machineryProjectDir: (p) => `/fake/${p}`,
    scheduleStore: createScheduleStore(undefined),
    branchStatus: new BranchStatusChecker({ run: async () => ({ code: 1, stdout: "" }), ttlMs: 0 }),
    readWorkflowHistory: () => ({}) as unknown as WorkflowHistoryChecker,
    readFreshness: () => ({}) as unknown as DescriptionFreshnessChecker,
    readSpecCreatedAt: () => ({}) as unknown as SpecCreatedAtChecker,
    readSpecFileCommits: () => ({}) as unknown as SpecFileCommitChecker,
    specsRoot: async (dir) => dir,
    readBranchFileSteps: () => ({}) as unknown as BranchFileStepsChecker,
    targets: () => [],
    readScan: () => null,
    invalidateScan: () => {
      invalidations += 1;
    },
    allowed: new Set(["aide"]),
    ensureCheckout: () => {
      sweeps += 1;
      if (!control.holding) return Promise.resolve(undefined);
      return new Promise((resolve) => held.push(() => resolve(undefined)));
    },
    queue: {} as unknown as QueueStore,
    specRoots: () => [],
    readRunner: () => null,
    checkoutEnsurer: {} as unknown as CheckoutEnsurer,
    notifyQueueChanged: () => {},
  };
  return {
    ctx,
    control,
    sweeps: () => sweeps,
    invalidations: () => invalidations,
    /** Lets the oldest held `ensureCheckout` answer. */
    release: () => held.shift()!(),
  };
}

/** Lets every pending promise reaction run, without a timer of the test's
 *  own deciding the outcome. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function track(p: Promise<void>) {
  const state = { done: false };
  void p.then(() => {
    state.done = true;
  });
  return state;
}

describe("settleSpecCaches", () => {
  test("waits for the running refresh, then drops the scan and reads again before it resolves (AC-1)", async () => {
    const { ctx, sweeps, invalidations, release } = heldCtx();
    const first = refreshSpecCaches(ctx);
    const settled = track(settleSpecCaches(ctx));
    await flush();
    // Still the first sweep alone: the settled read neither resolved nor
    // started one of its own while the first ran.
    expect(sweeps()).toBe(1);
    expect(invalidations()).toBe(0);
    expect(settled.done).toBe(false);

    release();
    await first;
    await flush();
    expect(invalidations()).toBe(1);
    expect(sweeps()).toBe(2);
    // The second sweep is held too: the settled read is not done before it.
    expect(settled.done).toBe(false);

    release();
    await flush();
    expect(settled.done).toBe(true);
  });

  test("with no refresh running, drops the scan and reads once (AC-1)", async () => {
    const { ctx, control, sweeps, invalidations } = heldCtx();
    control.holding = false;
    await settleSpecCaches(ctx);
    expect(invalidations()).toBe(1);
    expect(sweeps()).toBe(1);
  });

  test("a caller that only awaits it is done once the refresh ends, with no timer of its own (AC-2)", async () => {
    const { ctx, control, sweeps, release } = heldCtx();
    void refreshSpecCaches(ctx);
    const settled = settleSpecCaches(ctx);
    await flush();
    control.holding = false;
    release();
    // Nothing polls: the settled read is done before even a zero-delay
    // timer comes round.
    const first = await Promise.race([
      settled.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("timer"), 0)),
    ]);
    expect(first).toBe("settled");
    expect(sweeps()).toBe(2);
  });

  test("on one server does not wait for another server's refresh, which runs on (AC-4)", async () => {
    const a = heldCtx();
    const b = heldCtx();
    b.control.holding = false;
    const aRefresh = track(refreshSpecCaches(a.ctx));
    await settleSpecCaches(b.ctx);
    expect(b.sweeps()).toBe(1);
    expect(b.invalidations()).toBe(1);
    // A's refresh is still running, untouched by B's settled read.
    expect(aRefresh.done).toBe(false);
    expect(a.sweeps()).toBe(1);
    expect(a.invalidations()).toBe(0);
    // And a second refresh on A is still refused while its first runs.
    await refreshSpecCaches(a.ctx);
    expect(a.sweeps()).toBe(1);

    a.release();
    await flush();
    expect(aRefresh.done).toBe(true);
  });
});
