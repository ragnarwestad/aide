// A landing still in flight when the board stops — a restart, a crash, a
// power cut — is run again when the board comes back, from the step's own
// result file, through the same hook that started it. Dropped instead, it
// left 547's analysis on its branch and implement refused as "not
// analyzed yet" (2026-09-27).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import { resumeCutLandings } from "../../../src/queue/runner/cut-landing.ts";
import { DEFAULTS, cleanupHarness, dir, enqueue, makeRunner, okResult, resetHarness, spawns } from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const resolve = () => ({ specFolders: ["81-queue-and-runner"] });

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
    await Promise.resolve();
    await Promise.resolve();
    expect(restored.get(job.id)!.landing).toBeUndefined();
    runner.tick();
    expect(spawns.at(-1)!.step).toBe("implement");
  });

  test("with no result to land from, nothing is called and the queue is not held", () => {
    const { job, restored } = cutShort();
    let called = false;
    resumeCutLandings({ store: restored, readResult: () => null, onStepDone: () => void (called = true) });
    expect(called).toBe(false);
    expect(restored.get(job.id)!.landing).toBeUndefined();
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
