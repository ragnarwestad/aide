// The icon a state badge carries before its word. Shapes from Lucide
// (lucide.dev, ISC licence), inlined so the page stays one request and
// works with no script.
//
// Picked from the badge's own word, in either language, because that is
// the one thing every caller of `badge()` already hands over — a word
// with no icon here simply gets none.

const SHAPES: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  play: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  failed: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  stopped: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  closed: '<circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  dashed:
    '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/>' +
    '<path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/>' +
    '<path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
};

/** Which shape a badge's word takes. Checked in order, so the specific
 *  words come before the loose "-ing" catch for a step under way. */
const BY_WORD: [RegExp, keyof typeof SHAPES][] = [
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

/** The inline SVG for a badge's word, or "" when the word has none. */
export function stateIcon(word: string): string {
  const w = word.trim().toLowerCase();
  const hit = BY_WORD.find(([re]) => re.test(w));
  if (!hit) return "";
  const name = hit[1];
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true"${name === "loader" ? ' class="spin"' : ""}>${SHAPES[name]}</svg>`
  );
}
