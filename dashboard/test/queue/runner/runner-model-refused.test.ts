// A step the model declined to continue ends failed, and the row says which
// step and why in the board's own words.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

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

  test("ends failed with the board's message for the step, and keeps the script's sentence as detail (AC-2)", () => {
    const after = refused();
    expect(after?.state).toBe("failed");
    expect(after?.error).toEqual({ key: "runner.modelRefused", values: { button: "Analyze" } });
    expect(after?.errorDetail).toBe(SCRIPT_SENTENCE);
  });

  test("names Analyze and says the model declined to continue (AC-2)", () => {
    const text = renderSentence("en", refused()?.error as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain("Analyze");
    expect(text).toContain("declined to continue");
  });

  test("suggests running the step again or another model, and never install, login or Settings (AC-3)", () => {
    const text = renderSentence("en", refused()?.error as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain("Press Analyze again");
    expect(text).toContain("another model");
    expect(text).not.toMatch(/install|log ?in|logged in|Settings|Check/i);
  });
});
