// A step stopped at its own time limit is worded by the board: the limit,
// whether it ran out in the session or in the runner's own test run, and
// what to press, in the reader's language.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "../runner-fixtures.ts";
import { timeLimitMessage } from "../../../../src/queue/runner/cross-check-message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const stopped = (timeLimit: unknown) => ({ ok: false, terminalReason: "timeout", timeLimit, error: "stopped at its own 40-minute time limit for this step" });

describe("timeLimitMessage", () => {
  test("names the limit in whole minutes, and which part of the step ran out", () => {
    expect(timeLimitMessage("implement", stopped({ seconds: 2400, during: "session" }))).toEqual({
      key: "runner.timeLimitSession",
      values: { button: "Implement", limit: "40 min" },
    });
    expect(timeLimitMessage("implement", stopped({ seconds: 90, during: "tests" }))).toEqual({
      key: "runner.timeLimitTests",
      values: { button: "Implement", limit: "90 s" },
    });
  });

  test("leaves a result that names no limit to the runner's own sentence", () => {
    expect(timeLimitMessage("implement", stopped(undefined))).toBeUndefined();
  });
});

describe("a step stopped at its time limit", () => {
  test("keeps the board's sentence on the job, not the runner's English", () => {
    const job = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({ readResult: () => ({ ...okResult(0.1), ...stopped({ seconds: 600, during: "session" }) }) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("stopped");
    expect(store.get(job.id)?.error).toMatchObject({ key: "runner.timeLimitSession" });
  });
});
