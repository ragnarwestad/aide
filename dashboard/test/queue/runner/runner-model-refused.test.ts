// A step the model declined to continue ends failed, and the row says which
// step and why in the board's own words.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
import { withoutStepFailed } from "../../../src/messages/format.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const SCRIPT_SENTENCE =
  "Analyze stopped: the model declined to continue — press Analyze again, or choose another model for this step";

describe("a step the model refused", () => {
  const refused = () => {
    const job = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0.1), ok: false, terminalReason: "model-refused", error: SCRIPT_SENTENCE }),
    });
    runner.tick();
    runner.poll();
    return store.get(job.id);
  };

  test("ends failed with the board's message for the step, and keeps the script's sentence as detail", () => {
    const after = refused();
    expect(after?.state).toBe("failed");
    expect(withoutStepFailed(after?.error)).toEqual({ key: "runner.modelRefused", values: { button: "Analyze" } });
    expect(after?.errorDetail).toBe(SCRIPT_SENTENCE);
  });
});
