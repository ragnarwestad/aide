import { describe, expect, test } from "bun:test";
import { MESSAGES } from "./messages.ts";
import { en } from "./en.ts";
import { nb } from "./nb.ts";
import { BANNED_WORDS, findBannedWord } from "./banned-words.ts";

// Two keys are deliberately not scanned: `shell.tabSpecs` and
// `list.colSpec` name a section of the UI (the Specs tab, the Spec
// column) rather than a message describing an outcome or an action —
// REQ-8 ties "message" to something that resolves, which a tab name
// does not (2-analysis.md, "Scope decision"). Every other key in every
// catalog below is scanned with no further exception.
const NOT_A_MESSAGE = new Set(["shell.tabSpecs", "list.colSpec"]);

// REQ-6, spec 399 — kept apart from messages.test.ts's own REQ-6 (spec 380,
// resolve/exempt): a different requirement, from a different spec, that
// happens to share a number.
describe("no message uses a word the reader does not (REQ-1, REQ-2)", () => {
  const catalogs: Record<string, Record<string, string>> = {
    "messages.ts (en)": Object.fromEntries(Object.entries(MESSAGES).map(([k, v]) => [k, v.en])),
    "messages.ts (nb)": Object.fromEntries(Object.entries(MESSAGES).map(([k, v]) => [k, v.nb])),
    "en.ts": en,
    "nb.ts": nb,
  };
  for (const [catalog, entries] of Object.entries(catalogs)) {
    describe(catalog, () => {
      test.each(Object.entries(entries).filter(([k]) => !NOT_A_MESSAGE.has(k)))("%s", (key, text) => {
        const hit = findBannedWord(text);
        expect(hit, hit && `"${key}" says "${hit.word}" — say "${hit.insteadOf}" instead`).toBeUndefined();
      });
    });
  }
});

describe("the banned-word list itself (REQ-5)", () => {
  test("is non-empty and every entry names a word and its replacement", () => {
    expect(BANNED_WORDS.length).toBeGreaterThan(0);
    for (const b of BANNED_WORDS) {
      expect(b.word).toBeTruthy();
      expect(b.insteadOf).toBeTruthy();
      expect(b.pattern.test(b.word), `"${b.word}" does not match its own pattern`).toBe(true);
    }
  });

  // The words this list bans are the ones the reader was actually given.
  // Kept as literals rather than derived from the entries, so a pattern
  // narrowed by accident stops catching the sentence that put the word
  // on the board in the first place.
  test.each([
    ["The gate log names the failing test", "gate"],
    ["arkivering holdt tilbake i gaten", "gate"],
  ])("%s is refused", (text, word) => {
    expect(findBannedWord(text)?.word).toBe(word);
  });

  // And the everyday words that merely contain one.
  test.each(["investigate the failure", "navigate to the tab", "delegate it"])("%s is allowed", (text) => {
    expect(findBannedWord(text)).toBeUndefined();
  });
});
