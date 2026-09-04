// The inline SVGs the pages draw, and the one spinner.
//
// Split out of components.ts 2026-09-04 (510 lines). Every icon is
// unchanged and keeps its name; a colour is never the only signal,
// which is why each state has a SHAPE of its own here.



// --- icons -------------------------------------------------------------------

// Inline, like everything else here: the generated site is published as
// plain files by rsync and has to work opened from a folder, so there
// is no second request to make.

/** A finished phase. */
export const ICON_CHECK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M3 8.5l3 3 7-7"></path></svg>`;

/** A control that will not take a click, and says why in its `title`. */
export const ICON_LOCK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" aria-hidden="true">` +
  `<rect x="3.5" y="7" width="9" height="6" rx="1"></rect>` +
  `<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg>`;

/** The mark on a refusal or a warning. Colour is never the only signal:
 *  a reader who cannot tell red from amber still sees this. */
export const ICON_WARN =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M8 2.5l6 11H2z"></path><path d="M8 6.5v3.2M8 12h.01"></path></svg>`;

/** Something is happening. A span, not an SVG: it is one CSS rotation. */
export const SPINNER = `<span class="spin" aria-hidden="true"></span>`;

/** The spec page's PDF button (spec 358): a plain document, the same
 *  stroke-only convention every other icon here follows. */
export const ICON_PDF =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M4 1.5h5.5L12 4v10a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 14V2a.5.5 0 0 1 .5-.5z"></path>` +
  `<path d="M9.5 1.5V4H12"></path></svg>`;

/** One chevron for every fold control on the site — the specs list's own
 *  row, a phase, and (since spec 240's Steps tab) a step's own log.
 *  Shared rather than redefined per file: the `.fold`/`.fold.shut`
 *  rotate-in-CSS pair in css.ts is already one shared pattern, and a
 *  second copy of the SVG that drew it would be the same shape of
 *  duplication one layer up. Stroke-based so it takes the text colour
 *  and scales with the flat. */
export const ICON_CHEVRON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 6l4 4 4-4"></path></svg>';

/** A magnifying glass, left-aligned inside the specs-search field
 *  (design handoff, 2026-08-25) — same inline-SVG, stroke-only pattern
 *  as `ICON_CHEVRON`. */
export const ICON_SEARCH =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6">' +
  '<circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5L14 14" stroke-linecap="round"></path></svg>';

/** The header's theme switch (spec 243, relocated out of the "…"
 *  menu): a sun, a crescent moon, and a half-filled circle for Auto. */
export const ICON_THEME_DARK =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.2 4.2 0 0 0 6.5 6.5z"></path></svg>';

export const ICON_THEME_LIGHT =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<circle cx="8" cy="8" r="3"></circle>' +
  '<path d="M8 1.5v1.5M8 13v1.5M2.5 8H1M15 8h-1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"></path></svg>';

export const ICON_THEME_AUTO =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6">' +
  '<circle cx="8" cy="8" r="5.5"></circle>' +
  '<path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"></path></svg>';

/** What a page says where an answer has not arrived yet (spec 208).
 *
 *  Every question a render used to block on is a peek now, and a peek
 *  can say three things, not two: the answer, "asked and unanswerable",
 *  and "nobody has asked yet". This is the third. It is spelled out in
 *  one place because five call sites across three pages say it, and a
 *  page wording the same absence differently in two cells is a page
 *  whose two cells look like two different states.
 *
 *  It is NOT what an unanswerable question says — a spec git cannot
 *  date still shows a dash, and a file git cannot date still shows no
 *  stamp, exactly as each did before any of this was cached.
 *
 *  A pulsing bar, not the word (asked for 2026-08-24): the text read
 *  as a fact the row was stating rather than work in progress. The
 *  word survives inside, visually hidden, for screen readers — and for
 *  every test that asks whether a cell is still checking. */
export const CHECKING =
  '<span class="checking" title="checking…"><span class="sr">checking…</span></span>';
