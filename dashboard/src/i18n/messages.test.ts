import { describe, expect, test } from "bun:test";
import { MESSAGES, type MessageEntry } from "./messages.ts";
import { en } from "./en.ts";
import { nb } from "./nb.ts";
import { es } from "./es.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";

// REQ-6, proven here first against the catalog itself, before the
// registry test (test/render/ui/error-sentence-registry.test.ts) is
// rewritten to depend on it.
describe("every board message names its own resolution or a named exemption (REQ-6)", () => {
  test.each(Object.entries(MESSAGES) as [string, MessageEntry][])("%s", (_key, entry) => {
    expect(entry.resolve || entry.exempt).toBeTruthy();
    if (entry.resolve) expect(entry.en).toContain(entry.resolve);
  });

  test("every entry also carries a Norwegian text", () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.nb, `${key} has no nb text`).toBeTruthy();
    }
  });

  // Spec 484, AC-3: the same for the three languages added beside
  // English and Norwegian. `MessageEntry` already makes a missing field
  // a `tsc` error — this is the runtime half, proving the field is not
  // just present but non-empty.
  test.each(["es", "de", "fr"] as const)("every entry also carries a %s text", (lang) => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry[lang], `${key} has no ${lang} text`).toBeTruthy();
    }
  });
});

// Spec 484, Risk analysis: a translation that drops a `{placeholder}`
// compiles fine (both sides are plain `string`) and only shows up as
// literal braces in rendered text — this catches the drop at the source
// instead.
function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
}

describe("every {placeholder} in an English string is present in every other language (spec 484)", () => {
  test.each(Object.entries(MESSAGES) as [string, MessageEntry][])("MESSAGES.%s", (key, entry) => {
    const want = placeholders(entry.en);
    for (const lang of ["nb", "es", "de", "fr"] as const) {
      expect(placeholders(entry[lang]), `${key}.${lang} placeholders`).toEqual(want);
    }
  });

  test.each(Object.keys(en) as (keyof typeof en)[])("en.%s", (key) => {
    const want = placeholders(en[key]);
    for (const [name, catalog] of [["nb", nb], ["es", es], ["de", de], ["fr", fr]] as const) {
      expect(placeholders(catalog[key]), `${name}.${key} placeholders`).toEqual(want);
    }
  });
});
