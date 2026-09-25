// A scheduled job produces a report and never changes a repository: the
// script ends a run that committed as `scope-violation`, and the board
// says so in the reader's language.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { enqueue, makeRunner, okResult, resetHarness, cleanupHarness, store } from "./runner-fixtures.ts";
import { renderSentence, type BoardMessage } from "../../../src/i18n/message.ts";
import { noProgressMessage } from "../../../src/queue/runner/cross-check-message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const SCRIPT_SENTENCE =
  "a scheduled job cannot change the repository — it committed in proj, and that commit was discarded. Rewrite the job's prompt so it writes its findings into the report only; a change that should reach the repository goes through a spec.";

const scopeViolation = () => ({ ...okResult(0.1), ok: false, terminalReason: "scope-violation", error: SCRIPT_SENTENCE });

describe("a scheduled job that changed the repository", () => {
  test("is failed with the board's own message, the script's sentence kept as detail (AC-2)", () => {
    const job = enqueue({ specFolder: "schedule-nightly", steps: ["schedule"] });
    const runner = makeRunner({ readResult: scopeViolation });
    runner.tick();
    runner.poll();
    const after = store.get(job.id);
    expect(after?.state).toBe("failed");
    expect(after?.error).toEqual({ key: "runner.scheduleChangedRepository" });
    expect(after?.errorDetail).toBe(SCRIPT_SENTENCE);
  });

  test("the message renders in every language with no placeholder left (AC-2)", () => {
    const message: BoardMessage = { key: "runner.scheduleChangedRepository" };
    for (const lang of ["en", "nb", "es", "de", "fr"] as const) {
      const text = renderSentence(lang, message) ?? "";
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
    expect(renderSentence("en", message)).toContain("a scheduled job cannot change the repository");
    expect(renderSentence("nb", message)).toContain("planlagt jobb");
  });

  test("a scope-violation for any other step keeps its own sentence (AC-2)", () => {
    expect(noProgressMessage("analyze", { terminalReason: "scope-violation" })).toBeUndefined();
  });
});
