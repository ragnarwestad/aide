// An analyze the runner stopped on the project's acceptance criteria
// checks ends stopped, not failed, with a sentence naming each fault the
// plan review found, in the reader's language.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
import { renderSentence, type Sentence } from "../../../src/i18n/message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const SCRIPT_SENTENCE =
  "Analyze stopped on the acceptance criteria — not in EARS: AC-2, AC-4; no scenario for when the condition does not hold: AC-5. Put the description right, then press Analyze again.";

const stopped = (criteriaFaults?: unknown) => {
  const job = enqueue({ steps: ["analyze"] });
  const runner = makeRunner({
    readResult: () => ({
      ...okResult(0.1),
      ok: false,
      terminalReason: "acceptance-criteria",
      error: SCRIPT_SENTENCE,
      ...(criteriaFaults !== undefined ? { criteriaFaults } : {}),
    }),
  });
  runner.tick();
  runner.poll();
  return store.get(job.id);
};

describe("an analyze stopped on its acceptance criteria", () => {
  test("is stopped with the acceptance-criteria reason, and its sentence names each fault (AC-4)", () => {
    const after = stopped({ missing: true, notEars: ["AC-2", "AC-4"], noScenario: ["AC-5"] });
    expect(after?.state).toBe("stopped");
    expect(after?.stopReason).toBe("acceptance-criteria");
    const en = renderSentence("en", after?.error as Sentence) ?? "";
    const nb = renderSentence("nb", after?.error as Sentence) ?? "";
    for (const text of [en, nb]) {
      for (const ac of ["AC-2", "AC-4", "AC-5"]) expect(text).toContain(ac);
      expect(text).toContain("Analyze");
    }
    expect(en).toContain("no acceptance criteria");
    expect(nb).not.toBe(en);
  });

  test("keeps the runner's own sentence when the result lists no faults (AC-4)", () => {
    const after = stopped();
    expect(after?.state).toBe("stopped");
    expect(after?.error).toBe(SCRIPT_SENTENCE);
  });
});
