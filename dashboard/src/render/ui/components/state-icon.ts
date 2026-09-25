// The icon a state badge carries before its word. The shapes are
// stylesheet tokens (`--icon-*`, tokens.css), drawn by status-badge.css
// as a mask in the badge's own colour; the badge carries only the name,
// so a list of five hundred specs does not carry five hundred copies of
// the same drawing.
//
// Picked from the badge's own word, in either language, because that is
// the one thing every caller of `badge()` already hands over — a word
// with no icon here simply gets none.

/** Which shape a badge's word takes. Checked in order, so the specific
 *  words come before the loose "-ing" catch for a step under way. */
const BY_WORD: [RegExp, string][] = [
  [/^(done|ferdig)\b/, "check"],
  [/^(archived|arkivert)\b/, "archive"],
  [/^(ready|klar)\b/, "play"],
  [/^(queued|i kø)/, "clock"],
  [/^(failed|feilet)\b/, "failed"],
  [/^(stopped|stoppet)\b/, "stopped"],
  [/^(held back|holdt tilbake)/, "pause"],
  [/^(closed|lukket)\b/, "closed"],
  [/^(cancelled|interrupted|avbrutt)\b/, "ban"],
  [/^(not verified|ikke verifisert)/, "help"],
  [/^(not started|ikke startet)/, "dashed"],
  [/^(running|kjører)\b|^\w+ing\b|^\w+er\b/, "loader"],
];

/** The icon a badge's word takes, or "" when the word has none. */
export function stateIconName(word: string): string {
  const w = word.trim().toLowerCase();
  return BY_WORD.find(([re]) => re.test(w))?.[1] ?? "";
}
