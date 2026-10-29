// A step the provider had no room for stops, not fails, and the row says which
// model was full in the board's own words.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const SCRIPT_SENTENCE =
  "Analyze stopped: sonnet is at capacity right now — press Analyze again, or choose another model for this step";

describe("a step stopped because the model is at capacity", () => {
  const atCapacity = () => {
    const job = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0.1), ok: false, terminalReason: "model-at-capacity", error: SCRIPT_SENTENCE }),
    });
    runner.tick();
    runner.poll();
    return store.get(job.id);
  };

  test("ends stopped with the reason, not failed", () => {
    const after = atCapacity();
    expect(after?.state).toBe("stopped");
    expect(after?.stopReason).toBe("model-at-capacity");
  });

  test("names the model, says it is at capacity right now, and says to press the button or choose another model", () => {
    const text = renderSentence("en", atCapacity()?.error as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain("sonnet");
    expect(text).toContain("at capacity right now");
    expect(text).toContain("Press Analyze again, or choose another model for this step.");
  });
});
