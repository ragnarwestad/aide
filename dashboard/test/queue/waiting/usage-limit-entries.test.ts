// A step stopped by a used-up usage limit holds a place in the shared queue
// until it starts again, unless the spec has had a newer job for that step
// since the stop: the board then never starts it again, so it holds no place.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { store, enqueue, resetHarness, cleanupHarness } from "../runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const stopOnLimit = (id: string): void => {
  store.update(id, {
    state: "stopped", stopReason: "provider-limit", finishedAt: "2026-08-16T10:00:00.000Z",
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
