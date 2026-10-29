// The rules for a used-up usage limit, each once: what a stop writes on
// the job, which queued jobs the limit holds, and when a stopped job is
// queued again. The module is pure over the queue, so these tests build
// the queue by hand and ask it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { QueueStore, type Job } from "../../../../src/queue/queue.ts";
import { restartAfterUsageLimit, usageLimitHolds, usageLimitWait } from "../../../../src/queue/runner/usage-limit.ts";
import { cleanupHarness, DEFAULTS, dir, enqueue, resetHarness, store } from "../runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const at = (hhmm: string): number => Date.parse(`2026-08-16T${hhmm}:00Z`);
const iso = (hhmm: string): string => new Date(at(hhmm)).toISOString();

/** The AI each job runs on, by job id; claude unless a test says otherwise. */
const tools = new Map<string, string>();
const toolOf = (job: Job): string => tools.get(job.id) ?? "claude";
beforeEach(() => tools.clear());

let spec = 0;
/** A queued job, made at 08:00 and a minute later for each one after it, so
 *  every job is older than the stops the tests record at 10:00. */
function job(overrides: Record<string, unknown> = {}, tool = "claude"): Job {
  const specFolder = ["81-queue-and-runner", "91-parallel-spec-runs"][spec++ % 2]!;
  const made = enqueue({ specFolder, ...overrides });
  tools.set(made.id, tool);
  return store.update(made.id, { createdAt: new Date(at("08:00") + spec * 60_000).toISOString() })!;
}

/** A job a usage limit stopped at `stoppedAt`, waiting until `until`. */
function stopped(
  made: Job,
  stoppedAt: string,
  wait: { until: string; resetKnown: boolean } | undefined,
  createdAt?: string,
): Job {
  return store.update(made.id, {
    state: "stopped",
    stopReason: "provider-limit",
    finishedAt: iso(stoppedAt),
    ...(createdAt ? { createdAt: iso(createdAt) } : {}),
    results: [{ step: made.steps[0]!, ok: false, terminalReason: "provider-limit" } as never],
    usageLimitWait: wait ? { until: iso(wait.until), resetKnown: wait.resetKnown } : undefined,
  })!;
}

describe("the wait a stop writes on the job", () => {
  const stop = (resetsAt?: string) => ({
    terminalReason: "provider-limit",
    providerLimit: { tool: "claude", window: "five_hour", ...(resetsAt ? { resetsAt } : {}) },
  });

  test("a reset time later than the stop is the wait, and is known (AC-2)", () => {
    expect(usageLimitWait(stop(iso("14:00")), iso("10:00"))).toEqual({
      usageLimitWait: { until: iso("14:00"), resetKnown: true },
    });
  });

  test("a reset time at or before the stop, or none, waits one hour and is not known (AC-5)", () => {
    const hourOn = { usageLimitWait: { until: iso("11:00"), resetKnown: false } };
    expect(usageLimitWait(stop(), iso("10:00"))).toEqual(hourOn);
    expect(usageLimitWait(stop(iso("10:00")), iso("10:00"))).toEqual(hourOn);
    expect(usageLimitWait(stop(iso("09:00")), iso("10:00"))).toEqual(hourOn);
    expect(usageLimitWait(stop("not a time"), iso("10:00"))).toEqual(hourOn);
  });

  test("any other way of ending writes no wait (AC-2)", () => {
    expect(usageLimitWait({ terminalReason: "timeout" }, iso("10:00"))).toEqual({});
    expect(usageLimitWait({ terminalReason: "completed" }, iso("10:00"))).toEqual({});
  });
});

describe("the hold on an AI's queued steps", () => {
  test("a queued step of the AI is held until the stopped step's reset time (AC-1)", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const queued = job({ steps: ["analyze"] });
    const held = usageLimitHolds(store.list(), toolOf);
    expect(held.get(queued.id)).toEqual({ key: "runner.usageLimitHeld", values: { tool: "claude", at: iso("14:00") } });
  });

  test("a stop the board has no reset time for is held with the no-reset sentence (AC-5)", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "11:00", resetKnown: false });
    const queued = job({ steps: ["analyze"] });
    expect(usageLimitHolds(store.list(), toolOf).get(queued.id)).toEqual({
      key: "runner.usageLimitHeldNoReset", values: { tool: "claude", at: iso("11:00") },
    });
  });

  test("steps of every other AI are not held (AC-4)", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const codex = job({ steps: ["analyze"] }, "codex");
    const opencode = job({ steps: ["implement"] }, "opencode");
    const held = usageLimitHolds(store.list(), toolOf);
    expect(held.has(codex.id)).toBe(false);
    expect(held.has(opencode.id)).toBe(false);
  });

  test("a scheduled run is held like any other step (AC-12)", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const run = enqueue({ specFolder: "schedule-nightly", steps: ["schedule"] });
    expect(usageLimitHolds(store.list(), toolOf).has(run.id)).toBe(true);
  });

  test("a job whose own landing is in flight is never held", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const landing = job({ steps: ["analyze"] });
    store.update(landing.id, { landing: true });
    expect(usageLimitHolds(store.list(), toolOf).has(landing.id)).toBe(false);
  });

  test("a stop recorded without a wait holds nothing (AC-2)", () => {
    stopped(job({ steps: ["implement"] }), "10:00", undefined);
    const queued = job({ steps: ["analyze"] });
    expect(usageLimitHolds(store.list(), toolOf).size).toBe(0);
    expect(queued.state).toBe("queued");
  });
});

describe("queuing a stopped step again", () => {
  test("at the reset time it is queued again with the stop taken off it (AC-2)", () => {
    const made = stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    store.update(made.id, { error: { key: "runner.runVanished", values: { button: "x" } }, errorDetail: "raw" });
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    const after = store.get(made.id)!;
    expect(after.state).toBe("queued");
    expect(after.stopReason).toBeUndefined();
    expect(after.usageLimitWait).toBeUndefined();
    expect(after.finishedAt).toBeUndefined();
    expect(after.error).toBeUndefined();
    expect(after.errorDetail).toBeUndefined();
    expect(after.usageLimitProbe).toBeUndefined();
  });

  test("a minute before the reset time nothing moves (AC-2)", () => {
    const made = stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    restartAfterUsageLimit(store, toolOf, at("13:59"));
    expect(store.get(made.id)?.state).toBe("stopped");
  });

  test("a stop recorded without a wait is never queued again (AC-2)", () => {
    const made = stopped(job({ steps: ["implement"] }), "10:00", undefined);
    restartAfterUsageLimit(store, toolOf, at("23:00"));
    expect(store.get(made.id)?.state).toBe("stopped");
  });

  test("once the stopped step is queued again the steps behind it are not held (AC-3)", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const a = job({ steps: ["analyze"] });
    const b = job({ steps: ["implement"] });
    expect(usageLimitHolds(store.list(), toolOf).size).toBe(2);
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    const held = usageLimitHolds(store.list(), toolOf);
    expect(held.has(a.id) || held.has(b.id)).toBe(false);
  });

  test("a job whose own landing is in flight is left for the next tick", () => {
    const made = stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    store.update(made.id, { landing: true });
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    expect(store.get(made.id)?.state).toBe("stopped");
  });

  test("another AI's stop is not queued again by this AI's time", () => {
    const codex = stopped(job({ steps: ["implement"] }, "codex"), "10:00", { until: "16:00", resetKnown: true });
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    expect(store.get(codex.id)?.state).toBe("stopped");
  });
});

describe("a stop with no reset time sends one step ahead (AC-5)", () => {
  test("only the oldest is queued again, as the probe, and the rest wait an hour from then", () => {
    const a = stopped(job({ steps: ["implement"] }), "10:00", { until: "11:00", resetKnown: false }, "09:00");
    const b = stopped(job({ steps: ["implement"] }), "10:02", { until: "11:02", resetKnown: false }, "09:30");
    const c = job({ steps: ["analyze"] });

    restartAfterUsageLimit(store, toolOf, at("11:01"));
    expect(store.get(a.id)?.state).toBe("stopped");
    expect(store.get(b.id)?.state).toBe("stopped");

    restartAfterUsageLimit(store, toolOf, at("11:02"));
    expect(store.get(a.id)?.state).toBe("queued");
    expect(store.get(a.id)?.usageLimitProbe).toEqual({ results: 1, at: iso("11:02"), since: iso("10:00") });
    expect(store.get(b.id)?.state).toBe("stopped");
    expect(store.get(b.id)?.usageLimitWait).toEqual({ until: iso("12:02"), resetKnown: false });
    expect(usageLimitHolds(store.list(), toolOf).get(c.id)).toEqual({
      key: "runner.usageLimitHeldProbe", values: { tool: "claude", at: iso("11:02") },
    });
    expect(usageLimitHolds(store.list(), toolOf).has(a.id)).toBe(false);
  });

  test("while the probe runs nothing else is queued again", () => {
    const a = stopped(job({ steps: ["implement"] }), "10:00", { until: "11:00", resetKnown: false }, "09:00");
    const b = stopped(job({ steps: ["implement"] }), "10:02", { until: "11:02", resetKnown: false }, "09:30");
    restartAfterUsageLimit(store, toolOf, at("11:02"));
    expect(store.get(a.id)?.state).toBe("queued");
    restartAfterUsageLimit(store, toolOf, at("23:00"));
    expect(store.get(b.id)?.state).toBe("stopped");
  });

  test("a probe that ends without a usage-limit stop queues the rest at once and releases the queue", () => {
    const a = stopped(job({ steps: ["implement"] }), "10:00", { until: "11:00", resetKnown: false }, "09:00");
    const b = stopped(job({ steps: ["implement"] }), "10:02", { until: "11:02", resetKnown: false }, "09:30");
    const c = job({ steps: ["analyze"] });
    restartAfterUsageLimit(store, toolOf, at("11:02"));
    // The probe's step ends: a second result lands on the job.
    const probe = store.get(a.id)!;
    store.update(a.id, {
      state: "done",
      results: [...probe.results, { step: "implement", ok: true, terminalReason: "completed" } as never],
    });
    restartAfterUsageLimit(store, toolOf, at("11:20"));
    expect(store.get(b.id)?.state).toBe("queued");
    expect(usageLimitHolds(store.list(), toolOf).has(c.id)).toBe(false);
  });

  test("a probe that stops on the limit again moves the whole AI's time (AC-6)", () => {
    const a = stopped(job({ steps: ["implement"] }), "10:00", { until: "11:00", resetKnown: false }, "09:00");
    const b = stopped(job({ steps: ["implement"] }), "10:02", { until: "11:02", resetKnown: false }, "09:30");
    const c = job({ steps: ["analyze"] });
    restartAfterUsageLimit(store, toolOf, at("11:02"));
    const probe = store.get(a.id)!;
    store.update(a.id, {
      state: "stopped",
      stopReason: "provider-limit",
      finishedAt: iso("11:10"),
      results: [...probe.results, { step: "implement", ok: false, terminalReason: "provider-limit" } as never],
      usageLimitWait: { until: iso("15:00"), resetKnown: true },
    });
    restartAfterUsageLimit(store, toolOf, at("11:20"));
    expect(store.get(b.id)?.state).toBe("stopped");
    expect(usageLimitHolds(store.list(), toolOf).get(c.id)).toEqual({
      key: "runner.usageLimitHeld", values: { tool: "claude", at: iso("15:00") },
    });
  });
});

describe("a probe that stops again with a reset time (AC-6)", () => {
  test("the AI waits for that reset time, not for the other steps' placeholder wait", () => {
    const a = stopped(job({ steps: ["implement"] }), "10:00", { until: "11:00", resetKnown: false }, "09:00");
    const b = stopped(job({ steps: ["implement"] }), "10:02", { until: "11:02", resetKnown: false }, "09:30");
    const c = job({ steps: ["analyze"] });
    restartAfterUsageLimit(store, toolOf, at("11:02"));
    const probe = store.get(a.id)!;
    store.update(a.id, {
      state: "stopped", stopReason: "provider-limit", finishedAt: iso("11:10"),
      results: [...probe.results, { step: "implement", ok: false, terminalReason: "provider-limit" } as never],
      usageLimitWait: { until: iso("11:30"), resetKnown: true },
    });
    expect(usageLimitHolds(store.list(), toolOf).get(c.id)?.values).toEqual({ tool: "claude", at: iso("11:30") });
    restartAfterUsageLimit(store, toolOf, at("11:30"));
    expect(store.get(a.id)?.state).toBe("queued");
    expect(store.get(b.id)?.state).toBe("queued");
  });
});

describe("a restarted step that hits the limit again is held again (AC-6)", () => {
  test("it waits until the new reset time and the AI stays held until then", () => {
    const made = stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const queued = job({ steps: ["analyze"] });
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    const restarted = store.get(made.id)!;
    store.update(made.id, {
      state: "stopped",
      stopReason: "provider-limit",
      finishedAt: iso("14:05"),
      results: [...restarted.results, { step: "implement", ok: false, terminalReason: "provider-limit" } as never],
      ...usageLimitWait({ terminalReason: "provider-limit", providerLimit: { tool: "claude", window: "five_hour", resetsAt: iso("19:00") } }, iso("14:05")),
    });
    expect(usageLimitHolds(store.list(), toolOf).get(queued.id)).toEqual({
      key: "runner.usageLimitHeld", values: { tool: "claude", at: iso("19:00") },
    });
    restartAfterUsageLimit(store, toolOf, at("18:59"));
    expect(store.get(made.id)?.state).toBe("stopped");
    restartAfterUsageLimit(store, toolOf, at("19:00"));
    expect(store.get(made.id)?.state).toBe("queued");
  });
});

describe("a person's press (AC-11)", () => {
  test("a pressed job queued after the stop is not held", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const pressed = job({ steps: ["analyze"] });
    store.update(pressed.id, { pressed: true, createdAt: iso("10:30") });
    expect(usageLimitHolds(store.list(), toolOf).has(pressed.id)).toBe(false);
  });

  test("a job pressed before the stop is held with the rest", () => {
    stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const early = job({ steps: ["analyze"] });
    store.update(early.id, { pressed: true, createdAt: iso("09:00") });
    expect(usageLimitHolds(store.list(), toolOf).has(early.id)).toBe(true);
  });

  test("when the reset time comes, a stopped step a person has already pressed again stays stopped and its wait is cleared", () => {
    const made = stopped(job({ steps: ["implement"], specFolder: "81-queue-and-runner" }), "10:00", { until: "14:00", resetKnown: true });
    const again = enqueue({ specFolder: made.specFolder, steps: ["implement"] });
    tools.set(again.id, "claude");
    store.update(again.id, { pressed: true, createdAt: iso("10:30") });
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    expect(store.get(made.id)?.state).toBe("stopped");
    expect(store.get(made.id)?.usageLimitWait).toBeUndefined();
  });
});

describe("a press for another step of the spec", () => {
  test("does not stand the stopped step down (AC-2)", () => {
    const made = stopped(job({ steps: ["implement"], specFolder: "81-queue-and-runner" }), "10:00", { until: "14:00", resetKnown: true });
    const other = enqueue({ specFolder: made.specFolder, steps: ["analyze"] });
    tools.set(other.id, "claude");
    store.update(other.id, { pressed: true, createdAt: iso("10:30") });
    restartAfterUsageLimit(store, toolOf, at("14:00"));
    expect(store.get(made.id)?.state).toBe("queued");
  });
});

describe("a restart of the board (AC-13)", () => {
  test("the hold and the time to start again are read back from the mirror", () => {
    const made = stopped(job({ steps: ["implement"] }), "10:00", { until: "14:00", resetKnown: true });
    const queued = job({ steps: ["analyze"] });
    const reread = new QueueStore({
      mirrorPath: join(dir, "queue.json"),
      defaults: DEFAULTS,
      resolve: () => ({ specFolders: ["81-queue-and-runner", "91-parallel-spec-runs"] }),
    });
    expect(reread.get(made.id)?.usageLimitWait).toEqual({ until: iso("14:00"), resetKnown: true });
    expect(usageLimitHolds(reread.list(), toolOf).get(queued.id)?.values).toEqual({ tool: "claude", at: iso("14:00") });
    restartAfterUsageLimit(reread, toolOf, at("03:00"));
    expect(reread.get(made.id)?.state).toBe("stopped");
    restartAfterUsageLimit(reread, toolOf, at("14:00"));
    expect(reread.get(made.id)?.state).toBe("queued");
  });
});
