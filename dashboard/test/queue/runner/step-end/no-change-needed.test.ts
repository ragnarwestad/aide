// An analyze that found nothing to change ends the job: the runner said so
// with `noChangeNeeded` on its result, and no later step is started. Without
// the field the job goes on to Implement as before.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { noChangeNeeded } from "../../../../src/queue/runner/types.ts";
import { cleanupHarness, enqueue, makeRunner, okResult, resetHarness, spawns, store } from "../runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const VERDICT = { check: "grep -n Files core/scripts/lib/files-to-change.sh", why: "the section is already read" };

function analyzeEndingWith(result: Record<string, unknown>) {
  const job = enqueue({ steps: ["analyze", "implement", "archive"] });
  let answer: Record<string, unknown> | null = null;
  const runner = makeRunner({ readResult: () => answer });
  runner.tick();
  answer = result;
  runner.poll();
  runner.tick();
  return { ended: store.get(job.id)!, runner };
}

describe("an analyze that found no change needed", () => {
  test("ends the job done on analyze, and Implement is never started (AC-1)", () => {
    const { ended } = analyzeEndingWith({ ...okResult(0), noChangeNeeded: VERDICT });
    expect(ended.state).toBe("done");
    expect(ended.steps[ended.stepIndex]).toBe("analyze");
    expect(ended.results.at(-1)?.noChangeNeeded).toEqual(VERDICT);
    expect(spawns.map((s) => s.step)).toEqual(["analyze"]);
  });

  test("without the field, the job goes on to Implement (AC-3)", () => {
    const { ended } = analyzeEndingWith(okResult(0));
    expect(ended.steps[ended.stepIndex]).toBe("implement");
    expect(ended.results.at(-1)?.noChangeNeeded).toBeUndefined();
    expect(spawns.map((s) => s.step)).toEqual(["analyze", "implement"]);
  });

  test.each([
    ["no check", { check: "", why: "x" }],
    ["no reason", { check: "x", why: "" }],
    ["not an object", "yes"],
  ])("a field that is %s is dropped whole (AC-3)", (_label, raw) => {
    expect(noChangeNeeded(raw)).toBeUndefined();
  });
});
