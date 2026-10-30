// The usage-limit hold, wired: the tick restarts a stopped step and holds
// the AI's queued steps, and a person's press is marked and starts past
// the hold. The rules themselves are proven in
// `test/queue/runner/usage-limit/usage-limit.test.ts`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tickRunner, type ScheduleContext } from "../../../src/serve/schedules";
import { cleanupHarness, enqueue, makeRunner, resetHarness, setNow, spawns, store } from "../../queue/runner/runner-fixtures.ts";
import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { WAITING_RUNNER } from "../../helpers/waiting-runner.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness(undefined, IMPLEMENTED);
const own: string[] = [];

beforeEach(resetHarness);
afterEach(() => {
  cleanupHarness();
  harness.cleanup();
  while (own.length) rmSync(own.pop()!, { recursive: true, force: true });
});

const at = (hhmm: string): number => Date.parse(`2026-08-16T${hhmm}:00Z`);

describe("tickRunner with a used-up usage limit", () => {
  /** A Claude implement stopped at 10:00, waiting for a reset at 14:00. */
  function limitStop() {
    const stopped = enqueue({ steps: ["implement"] });
    store.update(stopped.id, {
      state: "stopped",
      stopReason: "provider-limit",
      createdAt: "2026-08-16T08:00:00.000Z",
      finishedAt: "2026-08-16T10:00:00.000Z",
      results: [{ step: "implement", ok: false, terminalReason: "provider-limit" } as never],
      usageLimitWait: { until: "2026-08-16T14:00:00.000Z", resetKnown: true },
    });
    return stopped;
  }

  const ctxAt = (hhmm: string, runner: ReturnType<typeof makeRunner>): ScheduleContext => {
    setNow(at(hhmm));
    return {
      queue: store,
      projectRoot: undefined,
      readRunner: () => runner,
      now: () => at(hhmm),
      checkoutEnsurer: { fresh: async () => undefined },
    } as unknown as ScheduleContext;
  };

  test("before the reset time a queued step of the AI is held and not spawned (AC-1)", async () => {
    limitStop();
    const queued = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["analyze"] });
    const runner = makeRunner({ maxConcurrent: 3 });
    await tickRunner(ctxAt("13:00", runner));
    expect(store.get(queued.id)?.state).toBe("queued");
    expect((store.get(queued.id)?.error as { key: string }).key).toBe("runner.usageLimitHeld");
    expect(spawns).toHaveLength(0);
  });

  test("at the reset time the stopped step starts without a press, and the held step with it (AC-2, AC-3)", async () => {
    const stopped = limitStop();
    const queued = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["analyze"] });
    const runner = makeRunner({ maxConcurrent: 3 });
    await tickRunner(ctxAt("13:00", runner));
    await tickRunner(ctxAt("14:00", runner));
    expect(store.get(stopped.id)?.state).toBe("running");
    expect(store.get(queued.id)?.state).toBe("running");
    expect(store.get(queued.id)?.error).toBeUndefined();
    expect(spawns.map((s) => s.step).sort()).toEqual(["analyze", "implement"]);
  });

  test("a scheduled run due during the hold is held, and is let go when the hold ends (AC-12)", async () => {
    limitStop();
    const run = enqueue({ specFolder: "schedule-nightly", steps: ["schedule"] });
    const runner = makeRunner({ maxConcurrent: 3 });
    await tickRunner(ctxAt("13:00", runner));
    expect(store.get(run.id)?.state).toBe("queued");
    await tickRunner(ctxAt("14:00", runner));
    // Still queued behind the restarted implement, which is the schedule's
    // own rule for a project with other work in flight — not the limit's.
    expect((store.get(run.id)?.error as { key: string } | undefined)?.key).not.toBe("runner.usageLimitHeld");
  });
});

describe("a person's press during the hold", () => {
  test("POST /api/queue marks the new job as pressed and starts it past the hold (AC-11)", async () => {
    const stoppedJob = {
      id: "old-1",
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      stepIndex: 0,
      state: "stopped",
      stopReason: "provider-limit",
      timeoutSec: {},
      permissionMode: {},
      model: {},
      results: [{ step: "implement", ok: false, terminalReason: "provider-limit", costUsd: 0 }],
      spentUsd: 0,
      createdAt: "2026-08-16T08:00:00.000Z",
      finishedAt: "2026-08-16T10:00:00.000Z",
      usageLimitWait: { until: "2099-01-01T00:00:00.000Z", resetKnown: true },
    };
    const scratch = mkdtempSync(join(tmpdir(), "aide-usage-limit-"));
    own.push(scratch);
    const preloaded = harness.start({
      extra: { queueRunnerBin: WAITING_RUNNER, queueResultDir: scratch, queueConcurrency: 3 },
      queueMirror: JSON.stringify([stoppedJob]),
    });
    const res = await fetch(`${preloaded.base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
    });
    expect(res.status).toBe(200);
    const mirror = JSON.parse(readFileSync(join(preloaded.dir, "queue.json"), "utf-8")) as {
      id: string; steps: string[]; pressed?: boolean; state: string; errorReason?: string;
    }[];
    const pressed = mirror.find((j) => j.steps[0] === "analyze")!;
    expect(pressed.pressed).toBe(true);
    expect(pressed.state).toBe("running");
    expect(pressed.errorReason).toBeUndefined();
  });
});
