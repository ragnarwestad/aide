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

  test("renders a message with no values unchanged", () => {
    expect(renderMessage("en", { key: "runner.notAnalyzed" })).toBe(
      "Held back: not analyzed yet — run /aide-analyze first",
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
      "Kjøringen forsvant uten å etterlate et resultat. — Trykk Archive igjen.",
    );
  });

  test("an array of mixed Sentences joins rendered text with '; '", () => {
    const result = renderSentence("en", ["cannot fast-forward main", { key: "runner.runVanished", values: { button: "Implement" } }]);
    expect(result).toBe("cannot fast-forward main; The run vanished without leaving a result. — Press Implement again.");
  });

  test("undefined stays undefined", () => {
    expect(renderSentence("en", undefined)).toBeUndefined();
  });

  test("an empty array renders as an empty string", () => {
    expect(renderSentence("en", [])).toBe("");
  });
});
