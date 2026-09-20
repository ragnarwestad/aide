// Spec 350, REQ-1/REQ-2: t() round-trips both languages, and a {param}
// placeholder is substituted rather than left literal.
// Spec 484: the same round-trip for the three languages added beside
// English and Norwegian — one source of truth (`LANGUAGES`), so a
// language missing from the registry fails here, not only in `tsc`.
import { describe, expect, test } from "bun:test";
import { t, LANGUAGES } from "../../src/i18n";

describe("the confirm boxes' shared answers (spec 518, AC-2)", () => {
  test("OK and Cancel in every language", () => {
    const cancel = { en: "Cancel", nb: "Avbryt", es: "Cancelar", de: "Abbrechen", fr: "Annuler" } as const;
    for (const lang of LANGUAGES) {
      expect(t(lang, "dialog.ok")).toBe("OK");
      expect(t(lang, "dialog.cancel")).toBe(cancel[lang]);
    }
  });
});

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

  test("the state column header carries REQ-1/REQ-2's new name", () => {
    expect(t("en", "list.colState")).toBe("State/Action");
    expect(t("nb", "list.colState")).toBe("Tilstand/Aksjon");
  });

  test("LANGUAGES names all five (spec 484, AC-4)", () => {
    expect(LANGUAGES.sort()).toEqual(["de", "en", "es", "fr", "nb"]);
  });

  test.each(["es", "de", "fr"] as const)("%s returns its own, non-English text for shell.theme", (lang) => {
    const text = t(lang, "shell.theme");
    expect(text).not.toBe(t("en", "shell.theme"));
    expect(text.length).toBeGreaterThan(0);
  });

  test.each(["es", "de", "fr"] as const)("%s substitutes a {param} placeholder", (lang) => {
    expect(t(lang, "list.stateQueuedPosition", { n: 1, total: 2 })).not.toContain("{n}");
  });
});
