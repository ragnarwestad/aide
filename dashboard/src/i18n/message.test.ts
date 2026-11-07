import { describe, expect, test } from "bun:test";
import { renderMessage, renderSentence } from "./message.ts";

describe("renderMessage", () => {
  test("renders a message with values substituted, per language", () => {
    expect(renderMessage("en", { key: "runner.dependencyNotArchived", values: { dependency: "80-x" } })).toBe(
      "Held back: depends on 80-x, which is not archived yet",
    );
    expect(renderMessage("nb", { key: "runner.dependencyNotArchived", values: { dependency: "80-x" } })).toBe(
      "Holdt tilbake: avhenger av 80-x, som ikke er arkivert ennå",
    );
  });

  test("renders a message with no values unchanged (AC-1)", () => {
    expect(renderMessage("en", { key: "runner.notAnalyzed" })).toBe(
      "Problem: Held back: not analyzed yet\nSolution: Press Analyze first",
    );
    expect(renderMessage("es", { key: "runner.notAnalyzed" })).toContain("Analizar");
    expect(renderMessage("de", { key: "runner.notAnalyzed" })).toContain("Analysieren");
    expect(renderMessage("fr", { key: "runner.notAnalyzed" })).toContain("Analyser");
  });

  test("a named shared-files push says the specs plan to change the files (AC-6)", () => {
    const message = renderMessage("en", {
      key: "push.stoppedSharedFilesNamed",
      values: { step: "Analyze", specs: "624, 619", button: "Analyze" },
    });
    expect(message).toContain("specs 624, 619 plan to change the same files");
  });

  test("a red merge-test push names the project checkout as the place to fix it (AC-2)", () => {
    const message = renderMessage("en", {
      key: "push.stoppedTestsRed",
      values: { step: "Archive", button: "Archive" },
    });
    expect(message).toContain("fix the failures in the project checkout");
  });
});

describe("renderSentence", () => {
  test("a plain string (a job stored earlier) renders as-is in any language", () => {
    expect(renderSentence("en", "git could not be run: ENOENT")).toBe("git could not be run: ENOENT");
    expect(renderSentence("nb", "git could not be run: ENOENT")).toBe("git could not be run: ENOENT");
  });

  test("a BoardMessage renders through the catalog", () => {
    expect(renderSentence("nb", { key: "runner.runVanished", values: { button: "Archive" } })).toBe(
      "Problem: Kjøringen forsvant uten å etterlate et resultat\nLøsning: Trykk Archive igjen",
    );
  });

  test("an array of mixed Sentences joins each as its own sentence", () => {
    const result = renderSentence("en", ["cannot fast-forward main", { key: "runner.runVanished", values: { button: "Implement" } }]);
    expect(result).toBe(
      "Problem: Cannot fast-forward main\nProblem: The run vanished without leaving a result\nSolution: Press Implement again",
    );
  });

  test("an array where every Sentence already ends in a full stop never joins with '.;'", () => {
    const result = renderSentence("en", ["cannot fast-forward main.", "the archived spec is on aide/04-x."]);
    expect(result).not.toContain(".;");
    expect(result).toBe("cannot fast-forward main. The archived spec is on aide/04-x.");
  });

  // The reader sees two sentences, so the second one has to LOOK like
  // one — joined behind a full stop, a lower-case opening reads as the
  // first sentence carrying on.
  test("every sentence after the first opens with a capital, in both languages", () => {
    expect(renderSentence("en", ["cannot fast-forward main", "the tests are red on this merge"])).toBe(
      "cannot fast-forward main. The tests are red on this merge",
    );
    expect(renderSentence("nb", ["kan ikke spole fram main", "ønsker du å prøve igjen"])).toBe(
      "kan ikke spole fram main. Ønsker du å prøve igjen",
    );
  });

  // A branch is a name, and a capitalised name is a different branch.
  test("a sentence that opens with a branch, a path or a command keeps its own spelling", () => {
    expect(renderSentence("en", ["the merge failed", "aide/04-x is still on origin"])).toBe(
      "the merge failed. aide/04-x is still on origin",
    );
    expect(renderSentence("en", ["the merge failed", "`bun test` exited 1"])).toBe(
      "the merge failed. `bun test` exited 1",
    );
  });

  test("the first sentence is left exactly as its writer spelled it", () => {
    expect(renderSentence("en", ["aide/04-x is still on origin", "the merge failed"])).toBe(
      "aide/04-x is still on origin. The merge failed",
    );
  });

  test("undefined stays undefined", () => {
    expect(renderSentence("en", undefined)).toBeUndefined();
  });

  test("an empty array renders as an empty string", () => {
    expect(renderSentence("en", [])).toBe("");
  });
});

// Typed text (a create's title) fills a blank as written.
describe("a value with replacement patterns fills its blank as typed", () => {
  test("renderMessage keeps $& and $$ literal", () => {
    expect(renderMessage("en", { key: "push.createFailed", inner: "cost $& then $$5" })).toContain(
      "cost $& then $$5",
    );
  });
  test("t keeps $& and $$ literal", () => {
    expect(renderMessage("en", { key: "create.failed", values: { project: "aide", title: "a $& b $$ c" }, inner: "r" })).toContain(
      "a $& b $$ c",
    );
  });
});
