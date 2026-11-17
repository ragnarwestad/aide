import { expect, test } from "bun:test";
import { landSuccessor } from "../../../src/queue/job-rules/land-retry.ts";
import { canRetryLand } from "../../../src/queue/steps.ts";

const cancelled = { id: "old", project: "aide", branch: "topic", steps: ["land"], stepIndex: 0, state: "cancelled" as const };

test("an older cancelled attempt cannot be run again after a new attempt was queued", () => {
  const next = { ...cancelled, id: "new", state: "queued" as const };
  const successor = landSuccessor(cancelled, [next, cancelled]);
  expect(successor).toEqual({ id: "new", landed: false });
  expect(canRetryLand({ ...cancelled, landSuccessor: successor })).toBe(false);
});

test("landed attempts are identified without changing the old cancelled result", () => {
  const done = { ...cancelled, id: "done", state: "done" as const };
  expect(landSuccessor(cancelled, [done, cancelled])).toEqual({ id: "done", landed: true });
  expect(landSuccessor(cancelled, [{ ...done, landing: true }, cancelled])).toEqual({ id: "done", landed: false });
  expect(cancelled.state).toBe("cancelled");
});

test("the latest attempt wins, including a later cancellation, while other branches and projects do not", () => {
  const next = { ...cancelled, id: "next" };
  expect(landSuccessor(cancelled, [{ ...next, id: "hidden", project: "hidden" }, { ...next, id: "other", branch: "other" }, next, cancelled]))
    .toEqual({ id: "next", landed: false });
  expect(landSuccessor(next, [next, cancelled])).toBeUndefined();
  expect(canRetryLand(next)).toBe(true);
});
