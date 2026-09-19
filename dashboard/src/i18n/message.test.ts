import { describe, expect, test } from "bun:test";
import { t } from "./index.ts";
import { renderMessage, renderSentence } from "./message.ts";

describe("renderMessage", () => {
  test("renders a message with values substituted, per language", () => {
    expect(renderMessage("en", { key: "runner.dependencyNotArchived", values: { dependency: "80-x" } })).toBe(
      "held back: depends on 80-x, which is not archived yet",
    );
    expect(renderMessage("nb", { key: "runner.dependencyNotArchived", values: { dependency: "80-x" } })).toBe(
      "holdt tilbake: avhenger av 80-x, som ikke er arkivert ennå",
    );
  });

  test("renders a message with no values unchanged", () => {
    expect(renderMessage("en", { key: "runner.notAnalyzed" })).toBe(
      "held back: not analyzed yet — run /aide-analyze first",
    );
  });
});

describe("renderSentence", () => {
  test("a plain string (REQ-4: a job stored before this spec) renders as-is in any language", () => {
    expect(renderSentence("en", "git could not be run: ENOENT")).toBe("git could not be run: ENOENT");
    expect(renderSentence("nb", "git could not be run: ENOENT")).toBe("git could not be run: ENOENT");
  });

  test("a BoardMessage renders through the catalog", () => {
    expect(renderSentence("nb", { key: "runner.runVanished", values: { button: "Archive" } })).toBe(
      "kjøringen forsvant uten å etterlate et resultat. — Trykk Archive igjen.",
    );
  });

  test("an array of mixed Sentences joins each as its own sentence", () => {
    const result = renderSentence("en", ["cannot fast-forward main", { key: "runner.runVanished", values: { button: "Implement" } }]);
    expect(result).toBe("cannot fast-forward main. The run vanished without leaving a result. — Press Implement again.");
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

// Spec 506: typed text (a create's title) fills a blank as written.
describe("a value with replacement patterns fills its blank as typed (AC-2)", () => {
  test("renderMessage keeps $& and $$ literal", () => {
    expect(renderMessage("en", { key: "push.createFailed", values: { reason: "cost $& then $$5" } })).toContain(
      "cost $& then $$5",
    );
  });
  test("t keeps $& and $$ literal", () => {
    expect(t("en", "list.createFailed", { project: "aide", title: "a $& b $$ c", reason: "r" })).toContain("a $& b $$ c");
  });
});
