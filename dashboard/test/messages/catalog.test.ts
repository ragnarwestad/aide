import { describe, expect, test } from "bun:test";
import { MESSAGES, type MessageEntry, type MessageKey } from "../../src/messages/catalog.ts";
import { formatMessage } from "../../src/messages/format.ts";
import { en } from "../../src/i18n/en.ts";
import { nb } from "../../src/i18n/nb.ts";
import { es } from "../../src/i18n/es.ts";
import { de } from "../../src/i18n/de.ts";
import { fr } from "../../src/i18n/fr.ts";

describe("every board message carries a text in every language", () => {
  test("every entry also carries a Norwegian text", () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.nb, `${key} has no nb text`).toBeTruthy();
    }
  });

  // The same for the three languages added beside
  // English and Norwegian. `MessageEntry` already makes a missing field
  // a `tsc` error — this is the runtime half, proving the field is not
  // just present but non-empty.
  test.each(["es", "de", "fr"] as const)("every entry also carries a %s text", (lang) => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry[lang], `${key} has no ${lang} text`).toBeTruthy();
    }
  });
});

// A translation that drops a `{placeholder}`
// compiles fine (both sides are plain `string`) and only shows up as
// literal braces in rendered text — this catches the drop at the source
// instead.
function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
}

describe("every {placeholder} in an English string is present in every other language", () => {
  test("every MESSAGES entry and every en key keeps its placeholders in nb, es, de and fr", () => {
    const offenders: string[] = [];
    const compare = (where: string, want: Set<string>, got: string) => {
      const have = placeholders(got);
      if (have.size !== want.size || [...want].some((p) => !have.has(p))) {
        offenders.push(`${where}: {${[...have].join("}, {")}} (en has {${[...want].join("}, {")}})`);
      }
    };
    for (const [key, entry] of Object.entries(MESSAGES) as [string, MessageEntry][]) {
      const want = placeholders(entry.en);
      for (const lang of ["nb", "es", "de", "fr"] as const) compare(`MESSAGES.${key}.${lang}`, want, entry[lang]);
    }
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const want = placeholders(en[key]);
      for (const [name, catalog] of [["nb", nb], ["es", es], ["de", de], ["fr", fr]] as const) {
        compare(`${name}.${key}`, want, catalog[key]);
      }
    }
    expect(offenders).toEqual([]);
  });
});

const LANGS = ["en", "nb", "es", "de", "fr"] as const;

// A job held behind a used-up usage limit starts by itself, so no sentence
// about the wait asks the reader to act: each has no solution and says why.
describe("the sentences about a used-up usage limit ask for no press", () => {
  const KEYS: (keyof typeof MESSAGES)[] = [
    "runner.usageLimitHeld", "runner.usageLimitHeldNoReset", "runner.usageLimitHeldProbe",
    "wordPhase.stopProviderLimit",
  ];

  test.each(KEYS)("%s is a statement and says why", (key) => {
    const entry = MESSAGES[key] as MessageEntry;
    expect(entry.solution, key).toBeUndefined();
    expect(entry.statement, key).toBeTruthy();
  });
});

describe("a sentence that informs is not a problem", () => {
  test("a statement is shown without a Problem label", () => {
    expect(formatMessage("en", { key: "push.scheduleDone", values: {} })).not.toStartWith("Problem:");
  });
});

describe("registered error sentences hold a fix apart from the problem", () => {
  test("every entry holds a fix in all five languages, or no fix and a reason (AC-1, AC-8)", () => {
    for (const [key, entry] of Object.entries(MESSAGES) as [string, MessageEntry][]) {
      if (entry.statement !== undefined) {
        expect(entry.statement, `${key} is a statement with no reason`).toBeTruthy();
        expect(entry.solution, `${key} is a statement with a solution`).toBeUndefined();
        continue;
      }
      if (entry.solution === null) {
        expect(entry.exempt, `${key} has no solution and no exempt reason`).toBeTruthy();
        continue;
      }
      expect(entry.solution, `${key} has neither a solution nor solution: null`).toBeTruthy();
      expect(entry.exempt, `${key} has a solution and an exempt reason`).toBeUndefined();
      for (const lang of LANGS) {
        expect(entry.solution![lang], `${key}.solution.${lang}`).toBeTruthy();
      }
    }
  });

  test("a fix keeps the same {placeholders} in every language", () => {
    for (const [key, entry] of Object.entries(MESSAGES) as [string, MessageEntry][]) {
      if (!entry.solution) continue;
      const want = placeholders(entry.solution.en);
      for (const lang of ["nb", "es", "de", "fr"] as const) {
        expect(placeholders(entry.solution[lang]), `${key}.solution.${lang} placeholders`).toEqual(want);
      }
    }
  });

  test("no fix offers a second fix (AC-2)", () => {
    for (const [key, entry] of Object.entries(MESSAGES) as [string, MessageEntry][]) {
      if (!entry.solution) continue;
      expect(entry.solution.en, key).not.toMatch(/(?:, | — |\. )or\b|\bor (?:choose|press|check|use|wait)\b/i);
    }
  });

  test("a message around a message that knows the fix carries none (AC-3)", () => {
    for (const key of [
      "runner.notPushedCode", "runner.notPushedSpecs", "runner.notFetchedCode", "runner.notFetchedSpecs",
      "landing.pushFailedTo", "landing.stepFailed",
    ] as const) {
      expect((MESSAGES[key] as MessageEntry).solution, key).toBeNull();
    }
  });

  test("repeat instructions name a button instead of a generic run", () => {
    for (const [key, entry] of Object.entries(MESSAGES) as [string, MessageEntry][]) {
      const fix = entry.solution?.en ?? "";
      if (!fix.includes("{button}")) {
        expect(fix, key).not.toMatch(/\b(?:run|running|try running|step) (?:it |the step )?again\b/i);
        expect(fix, key).not.toMatch(/\brun \/aide-/i);
      }
    }
  });
});

// Two keys that say the same thing in two places share one entry, so a
// translation fixed under one key cannot drift from the other.
describe("keys that say the same thing carry the same entry", () => {
  test.each([
    ["runner.scopeSpecs", "runner.scopeSpecsNamed"],
    ["runner.sharedFilesStopped", "wordPhase.stopSharedFilesNamed"],
    ["runner.modelRefused", "wordPhase.stopModelRefused"],
  ] as [MessageKey, MessageKey][])("%s and %s", (one, other) => {
    expect(MESSAGES[one]).toBe(MESSAGES[other]);
  });
});
