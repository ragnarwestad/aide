// --- spec 199: a running phase counts up while the reader watches ---------
//
// The one timer on this page, and deliberately the narrowest one there
// can be. Spec 189 took the five-second POLL away so a reader with the
// browser's own tools open could hold still on a row; that rule stands
// — this fetches nothing, swaps no rows, and touches no attribute that
// could move anything. It rewrites the TEXT of the marks that carry
// their own start, and nothing else on the page.
//
// HAND-PAIRED with `durationLabel` in `src/render/ui/job-state.ts`. The
// two run in different processes — one in the browser, one on the
// server rendering the page — so the wording rule exists twice, and the
// two are pinned by a test rather than trusted:
// `test/queue-client/live-redraw.test.ts`'s "the page words a duration
// exactly as the server does" runs a tick against the imported
// `durationLabel` over a table of spans. Change one and change the
// other.
//
// The caller (the entry point) still looks the marks up fresh
// on every tick, which is what lets it survive `swapRows()` replacing
// `#jobrows` underneath it with no rebinding at all.
export function formatElapsed(ms: number): string {
  // A genuinely positive span never rounds down to "0s" (spec 410,
  // REQ-5) — the identical change to `durationLabel`'s own, kept in
  // lock-step per this file's own hand-pairing comment above.
  const secs = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  if (secs < 60) return `${secs}s`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  // The space between the two parts is `durationLabel`'s own, kept in
  // lock-step per this file's hand-pairing comment above.
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${pad(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h ${pad(Math.floor((secs % 3600) / 60))}m`;
}
