// While a restart waits after a deploy, the queue starts no new phase: the
// wait then ends when the phases already running do, rather than lasting as
// long as the queue keeps feeding it — and the restart never has to give up
// and cut a phase or a merge short.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHarness, enqueue, makeRunner, resetHarness, spawns, store } from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

describe("a restart waiting after a deploy", () => {
  test("holds every queued phase back, with the reason on its row", () => {
    const job = enqueue();
    makeRunner({ startsHeld: () => true }).tick();
    expect(spawns).toHaveLength(0);
    expect(store.get(job.id)?.error).toEqual({ key: "runner.heldForRestart" });
  });

  test("once the restart has fired, the queue starts where it left off", () => {
    let waiting = true;
    const job = enqueue();
    const runner = makeRunner({ startsHeld: () => waiting });
    runner.tick();
    waiting = false;
    runner.tick();
    expect(spawns.map((s) => s.jobId)).toEqual([job.id]);
    expect(store.get(job.id)?.error).toBeUndefined();
  });
});
