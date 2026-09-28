// t() returns the requested language's string, falls on no other
// language by mistake, and substitutes a {param} placeholder rather than
// leaving it literal. `LANGUAGES` is the one registry of languages, so a
// language missing from it fails here, not only in `tsc`.
import { describe, expect, test } from "bun:test";
import { t, LANGUAGES } from "../../src/i18n";

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

  test("LANGUAGES names all five", () => {
    expect(LANGUAGES.sort()).toEqual(["de", "en", "es", "fr", "nb"]);
  });
});
