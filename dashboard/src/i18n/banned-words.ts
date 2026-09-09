// The words a board message may not use, and what to say instead (REQ-5,
// spec 399) — read by banned-words.test.ts (REQ-6) so a new message
// reaching for one of these fails on sight rather than shipping.
export interface BannedWord {
  /** What a message should never say. */
  word: string;
  /** What it should say instead. */
  insteadOf: string;
  /** Case-insensitive; matches every inflection in one entry. Verified
   *  against the full current catalog (dashboard/src/i18n/{messages,en,nb}.ts)
   *  and against "Ireland"/"landmark"/"landscape" for false positives. */
  pattern: RegExp;
}

export const BANNED_WORDS: BannedWord[] = [
  // "landing"/"landed"/"lande"/"landet"/"land it" (en) and "landing"/
  // "landingen"/"landet"/"lande" (nb) — every inflection actually seen in
  // the current catalog, plus bare "land"/"lands" (the verb "to land
  // it"), without matching "Ireland"/"landmark"/"landscape".
  { word: "landing", insteadOf: "merge", pattern: /\bland(?:ing\w*|ed|et|e|s)?\b/i },
  { word: "spesifikasjon", insteadOf: "spec", pattern: /spesifikasjon/i },
  // "sammenslåing(en)" and the discontinuous "slå/slått ... sammen"
  // (0 or 1 word between, e.g. "slå sammen", "slå den sammen").
  { word: "sammenslå", insteadOf: "merge", pattern: /sammensl[åa]|slå(?:tt)?(?:\s+\w+)?\s+sammen/i },
  // "gate" is a word from the machinery, and in Norwegian it is a
  // street. The thing it named is the project's own tests, run on the
  // merge — so a message says "the test log", "the tests", "the test
  // run". Anchored to the whole word, so "investigate"/"navigate" and
  // the Norwegian "gaten" as part of a longer word are untouched.
  { word: "gate", insteadOf: "test / test log / test run", pattern: /\bgate(?:n|r|ne|s|d)?\b/i },
];

export function findBannedWord(text: string): BannedWord | undefined {
  return BANNED_WORDS.find((b) => b.pattern.test(text));
}
