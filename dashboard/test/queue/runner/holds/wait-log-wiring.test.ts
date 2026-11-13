// The runner hands every hold to the wait log: a job kept waiting past
// the threshold for a free slot leaves a line naming it.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanupHarness, enqueue, makeRunner, now, resetHarness, setNow } from "../runner-fixtures.ts";
import { WAIT_LOG_AFTER_MS } from "../../../../src/queue/runner/wait-log.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

test("a job held for a slot past the threshold is logged with its hold", () => {
  const lines: string[] = [];
  const runner = makeRunner({ maxConcurrent: 1, log: (line) => lines.push(line) });
  enqueue();
  const waiting = enqueue({ specFolder: "91-parallel-spec-runs" });
  runner.tick();
  setNow(now + WAIT_LOG_AFTER_MS);
  runner.tick();
  expect(lines.some((line) => line.includes(waiting.id.slice(0, 8)) && line.includes("no-free-slot"))).toBe(true);
});
