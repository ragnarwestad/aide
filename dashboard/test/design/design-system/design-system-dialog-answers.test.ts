// Spec 518: the two answers of a confirm box are one component, so the
// order, the Cancel form and its label are written once.
import { describe, expect, test } from "bun:test";
import { dialogAnswers } from "../../../src/render/ui/components/index.ts";
import { LANGUAGES } from "../../../src/i18n";

const AFFIRMATIVE = `<form method="dialog"><button class="btn danger" type="submit" value="leave">OK</button></form>`;
const CANCEL_LABEL = { en: "Cancel", nb: "Avbryt", es: "Cancelar", de: "Abbrechen", fr: "Annuler" } as const;

describe("dialogAnswers() (spec 518)", () => {
  test("one div.dialogactions holds the affirmative first and Cancel second (AC-6)", () => {
    const html = dialogAnswers("en", AFFIRMATIVE);
    expect(html.startsWith(`<div class="dialogactions">${AFFIRMATIVE}`)).toBe(true);
    expect(html.match(/<div/g)).toHaveLength(1);
    expect(html.indexOf(AFFIRMATIVE)).toBeLessThan(html.indexOf(">Cancel<"));
  });

  test("Cancel is the platform's own close: no action, no id, no button type (AC-5, AC-6)", () => {
    for (const lang of LANGUAGES) {
      const html = dialogAnswers(lang, AFFIRMATIVE);
      expect(html).toContain(
        `<form method="dialog"><button class="btn" type="submit">${CANCEL_LABEL[lang]}</button></form>`,
      );
      expect(html).not.toContain("id=");
      expect(html).not.toContain("action=");
      expect(html).not.toContain('type="button"');
    }
  });
});
