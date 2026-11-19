// A step stopped by a used-up usage limit holds a place in the shared queue
// until it starts again, unless the spec has had a newer job for that step
// since the stop: the board then never starts it again, so it holds no place.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { store, enqueue, makeRunner, resetHarness, cleanupHarness } from "../runner/runner-fixtures.ts";

import { restartAfterUsageLimit } from "../../../src/queue/runner/usage-limit.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const stopOnLimit = (id: string): void => {
  store.update(id, {
    state: "waiting", stopReason: "provider-limit", finishedAt: "2026-08-16T10:00:00.000Z",
    usageLimitWait: { until: "2026-08-19T04:00:00.000Z", resetKnown: true },
  });
};
const queuedJobs = (): (string | undefined)[] => store.waiting.snapshot().entries.map((entry) => entry.jobId);

test("a step stopped on a usage limit holds a place in the queue", () => {
  const stopped = enqueue();
  stopOnLimit(stopped.id);
  expect(queuedJobs()).toContain(stopped.id);
});

test("a stopped step its spec has run again since holds no place in the queue", () => {
  const stopped = enqueue();
  stopOnLimit(stopped.id);
  const again = enqueue({ steps: ["analyze", "implement"] });
  store.update(again.id, { state: "done", createdAt: "2026-08-16T11:00:00.000Z" });
  expect(queuedJobs()).not.toContain(stopped.id);
});

for (const saveWhileRunning of [false, true]) test(`a running step keeps its place through quota waiting, editor Save=${saveWhileRunning} (AC-2)`, () => {
  const a = enqueue({ steps: ["analyze", "implement"] });
  const runner = makeRunner({ maxConcurrent: 1 });
  runner.tick();
  expect(store.get(a.id)?.state).toBe("running");
  const b = enqueue({ specFolder: "91-parallel-spec-runs" });
  expect(queuedJobs()).toEqual([b.id]);
  if (saveWhileRunning) {
    const owner = store.waiting.open("edit while running");
    store.waiting.save(owner, owner.entries.map(entry => entry.id));
  }
  stopOnLimit(a.id);
  expect(queuedJobs()).toEqual([a.id, b.id]);
  restartAfterUsageLimit(store, () => "claude", Date.parse("2026-08-19T04:00:00Z"));
  expect(queuedJobs()).toEqual([a.id, b.id]);
  runner.tick();
  expect(store.get(a.id)?.state).toBe("running");
  expect(store.get(b.id)?.state).toBe("queued");
});
