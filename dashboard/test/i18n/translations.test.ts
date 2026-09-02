// Spec 350, REQ-1/REQ-2: t() round-trips both languages, and a {param}
// placeholder is substituted rather than left literal.
import { describe, expect, test } from "bun:test";
import { t } from "../../src/i18n/index.ts";

describe("t()", () => {
  test("returns the English source string for en", () => {
    expect(t("en", "shell.theme")).toBe("Theme");
  });

  test("returns a different, Norwegian string for nb", () => {
    const nbText = t("nb", "shell.theme");
    expect(nbText).not.toBe(t("en", "shell.theme"));
    expect(nbText).toBe("Tema");
  });

  test("substitutes a {param} placeholder", () => {
    expect(t("en", "list.stateQueued", { step: "analyzing" })).toBe("analyzing queued");
    expect(t("nb", "list.stateQueued", { step: "analyserer" })).toBe("analyserer i kø");
  });
});
