// The icon a state badge carries before its word. The shapes are
// stylesheet tokens (`--icon-*`, tokens.css), drawn by status-badge.css
// as a mask in the badge's own colour; the badge carries only the name,
// so a list of five hundred specs does not carry five hundred copies of
// the same drawing.
//
// Picked from the badge's own word, in any language, because that is the
// one thing every caller of `badge()` already hands over — a word with no
// icon here simply gets none. A job state's word is read from every
// catalogue, so a state shown in Spanish, German or French keeps its icon.

import { LANGUAGES, t, type TranslationKey } from "../../../i18n";

/** A state's word in every language, matched at the start of the badge's
 *  word and ended where a letter does not follow — `\b` never ends a word
 *  that ends in `é`. */
const stateWords = (...keys: TranslationKey[]): RegExp => {
  const words = keys.flatMap((key) => LANGUAGES.map((lang) => t(lang, key).toLowerCase()));
  const escaped = [...new Set(words)].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${escaped.join("|")})(?!\\p{L})`, "u");
};

/** Which shape a badge's word takes. Checked in order, so the specific
 *  words come before the loose "-ing" catch for a step under way. */
const BY_WORD: [RegExp, string][] = [
  [stateWords("state.done"), "check"],
  [/^(archived|arkivert)\b/, "archive"],
  [/^(ready|klar)\b/, "play"],
  [stateWords("state.queued"), "clock"],
  [stateWords("state.failed"), "failed"],
  [stateWords("state.stopped"), "stopped"],
  [stateWords("state.heldBack"), "pause"],
  [/^(closed|lukket)\b/, "closed"],
  [stateWords("state.cancelled", "state.interrupted"), "ban"],
  [/^(not verified|ikke verifisert)/, "help"],
  [/^(not started|ikke startet)/, "dashed"],
  [stateWords("state.running"), "loader"],
  [/^\w+ing\b|^\w+er\b/, "loader"],
];

/** The icon a badge's word takes, or "" when the word has none. */
export function stateIconName(word: string): string {
  const w = word.trim().toLowerCase();
  return BY_WORD.find(([re]) => re.test(w))?.[1] ?? "";
}
