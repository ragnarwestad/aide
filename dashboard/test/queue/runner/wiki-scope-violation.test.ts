// A wiki build that wrote outside its scope is ended `scope-violation` by
// the script; the board says so in the reader's language.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { enqueue, makeRunner, okResult, resetHarness, cleanupHarness, store } from "./runner-fixtures.ts";
import { renderSentence, type BoardMessage } from "../../../src/i18n/message.ts";
import { noProgressMessage } from "../../../src/queue/runner/cross-check-message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const SCRIPT_SENTENCE = "the wiki build wrote what it may not — notes.md — and that was taken back.";
const scopeViolation = () => ({ ...okResult(0.1), ok: false, terminalReason: "scope-violation", error: SCRIPT_SENTENCE });

describe("a wiki build that wrote outside its scope", () => {
  test("is failed with the board's own message, the script's sentence kept as detail (AC-1)", () => {
    const job = enqueue({ specFolder: "wiki-aide", steps: ["wiki"] });
    const runner = makeRunner({ readResult: scopeViolation });
    runner.tick();
    runner.poll();
    const after = store.get(job.id);
    expect(after?.state).toBe("failed");
    expect(after?.error).toEqual({ key: "runner.wikiWroteOutsideItsScope" });
    expect(after?.errorDetail).toBe(SCRIPT_SENTENCE);
  });

  test("the message renders in every language with no placeholder left (AC-1)", () => {
    const message: BoardMessage = { key: "runner.wikiWroteOutsideItsScope" };
    for (const lang of ["en", "nb", "es", "de", "fr"] as const) {
      const text = renderSentence(lang, message) ?? "";
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  test("a scope-violation for another step keeps its own sentence (AC-1)", () => {
    expect(noProgressMessage("analyze", { terminalReason: "scope-violation" })).toBeUndefined();
  });
});

// A build refused every aide-wiki call read as done; the script now ends a
// build that left no index `no-progress`, and the board says what that means.
describe("a wiki build that did not finish", () => {
  test("is failed with the board's own message, in every language", () => {
    const job = enqueue({ specFolder: "wiki-aide", steps: ["wiki"] });
    const runner = makeRunner({ readResult: () => ({ ...okResult(0.1), ok: false, terminalReason: "no-progress", error: "the wiki build left no wiki" }) });
    runner.tick();
    runner.poll();
    const after = store.get(job.id);
    expect(after?.state).toBe("failed");
    expect(after?.error).toEqual({ key: "runner.wikiBuildUnfinished" });
    for (const lang of ["en", "nb", "es", "de", "fr"] as const) {
      expect((renderSentence(lang, { key: "runner.wikiBuildUnfinished" }) ?? "").length).toBeGreaterThan(20);
    }
  });
});
