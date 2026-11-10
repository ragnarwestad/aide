// A landing still in flight when the board stops — a restart, a crash, a
// power cut — is run again when the board comes back, from the step's own
// result file, through the same hook that started it. Dropped instead, it
// left an analysis on its branch and implement refused as "not
// analyzed yet". It holds and stamps its step through the same helper as
// a landing that was not cut.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { QueueStore } from "../../../../src/queue/queue.ts";
import { resumeCutLandings } from "../../../../src/queue/runner/cut-landing.ts";
import { analysisSessionToResume } from "../../../../src/serve/serve-helpers/runner-argv.ts";
import {
  DEFAULTS, cleanupHarness, dir, enqueue, makeRunner, okResult, resetHarness, setNow, spawns, store,
} from "../runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const resolve = () => ({ specFolders: ["81-queue-and-runner", "91-parallel-spec-runs"] });
const iso = (ms: number) => new Date(ms).toISOString();
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** A job whose analyze finished and whose landing never settled, and the
 *  board read back from its mirror as it would be after a restart. */
function cutShort() {
  const job = enqueue({ steps: ["analyze", "implement"] });
  const before = makeRunner({ readResult: () => okResult(1), onStepDone: () => new Promise(() => {}) });
  before.tick();
  before.poll();
  return { job, restored: new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve }) };
}

describe("a landing the last process never finished", () => {
  test("is run again with the step's own result, and holds the job's next step until it settles", async () => {
    const { job, restored } = cutShort();
    let settle!: () => void;
    const calls: { step?: string; ok?: boolean }[] = [];
    const runner = makeRunner({ store: restored });
    const spawned = spawns.length;
    resumeCutLandings({
      store: restored,
      readResult: () => okResult(1),
      onStepDone: (_j, step, outcome) => {
        calls.push({ step, ok: outcome.ok });
        return new Promise<void>((r) => (settle = r));
      },
    });
    expect(calls).toEqual([{ step: "analyze", ok: true }]);
    expect(restored.get(job.id)!.landing).toBe(true);
    runner.tick();
    expect(spawns.length).toBe(spawned);
    settle();
    await flush();
    expect(restored.get(job.id)!.landing).toBeUndefined();
    runner.tick();
    expect(spawns.at(-1)!.step).toBe("implement");
  });

  test("stamps its step when it settles, as a landing that was not cut does, and its implement continues the analysis's session (AC-2)", async () => {
    const { job, restored } = cutShort();
    // A landing that was not cut, beside it: stamped when it settles.
    const uncut = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["analyze"] });
    let settleUncut!: () => void;
    const runner = makeRunner({ readResult: () => okResult(1), onStepDone: () => new Promise<void>((r) => (settleUncut = r)) });
    runner.tick();
    runner.poll();
    expect(store.get(uncut.id)!.results.at(-1)!.at).toBeUndefined();
    setNow(Date.parse("2026-08-16T10:05:00Z"));
    settleUncut();
    await flush();
    expect(store.get(uncut.id)!.results.at(-1)!.at).toBe("2026-08-16T10:05:00.000Z");
    expect(store.get(uncut.id)!.landing).toBeUndefined();

    let settle!: () => void;
    let clock = Date.parse("2026-08-16T11:00:00Z");
    resumeCutLandings({
      store: restored,
      readResult: () => okResult(1),
      onStepDone: () => new Promise<void>((r) => (settle = r)),
      now: () => iso(clock),
    });
    expect(restored.get(job.id)!.results.at(-1)!.at).toBeUndefined();
    clock = Date.parse("2026-08-16T11:07:00Z");
    settle();
    await flush();
    const resumed = restored.get(job.id)!;
    expect(resumed.results.at(-1)!.at).toBe("2026-08-16T11:07:00.000Z");
    expect(resumed.landing).toBeUndefined();
    const implement = { ...resumed, id: "next", steps: ["implement" as const], stepIndex: 0, results: [] };
    expect(analysisSessionToResume(implement, restored.list(), "claude", clock + 60_000)).toBe("s1");
  });

  test("with no result to land from, nothing is called, the step is stamped at boot and the queue is not held (AC-2)", () => {
    const { job, restored } = cutShort();
    let called = false;
    const writes: Record<string, unknown>[] = [];
    const update = restored.update.bind(restored);
    restored.update = (id, patch) => (writes.push(patch), update(id, patch));
    resumeCutLandings({
      store: restored, readResult: () => null, onStepDone: () => void (called = true), now: () => "2026-08-16T12:00:00.000Z",
    });
    expect(called).toBe(false);
    expect(writes.some((patch) => patch.landing)).toBe(false);
    expect(restored.get(job.id)!.landing).toBeUndefined();
    expect(restored.get(job.id)!.results.at(-1)!.at).toBe("2026-08-16T12:00:00.000Z");
  });

  test("whose hook starts no landing, the step is stamped at boot and the queue is not held (AC-2)", () => {
    const { job, restored } = cutShort();
    resumeCutLandings({
      store: restored, readResult: () => okResult(1), onStepDone: () => undefined, now: () => "2026-08-16T12:00:00.000Z",
    });
    expect(restored.get(job.id)!.landing).toBeUndefined();
    expect(restored.get(job.id)!.results.at(-1)!.at).toBe("2026-08-16T12:00:00.000Z");
  });

  test("is run once, not again at the next boot after it settled", () => {
    const { restored } = cutShort();
    let calls = 0;
    const again = { store: restored, readResult: () => okResult(1), onStepDone: () => void calls++ };
    resumeCutLandings(again);
    resumeCutLandings(again);
    expect(calls).toBe(1);
  });
});
