// The spec drawn in the open row of the Specs list is kept across every
// redraw of the rows. The server draws that row's cell empty in the rows it
// answers, since building the spec on every change would read git for each;
// the page holds the live one and puts it back where the fresh stand-in is,
// so the editor, a half-typed description and ticks not yet saved survive.

const DETAIL = "tr[data-spec-detail]";
const KEY = "data-spec-detail";

/** Takes the live spec out of the rows about to be replaced, leaving an
 *  empty stand-in in its place, and returns what puts it back: it finds the
 *  stand-in that has the same key afterwards, which is the fresh one when
 *  the spec's rows were redrawn and the one left here when they were not.
 *  A spec whose row is gone from the page takes the held element with it. */
export function holdSpecDetail(body: ParentNode): () => void {
  const live = body.querySelector(DETAIL) as HTMLElement | null;
  if (!live) return () => {};
  const key = live.getAttribute(KEY)!;
  const focused = live.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
  const standIn = document.createElement("tr");
  standIn.setAttribute(KEY, key);
  live.replaceWith(standIn);
  return () => {
    for (const el of Array.from(body.querySelectorAll(DETAIL))) {
      if (el.getAttribute(KEY) !== key) continue;
      el.replaceWith(live);
      focused?.focus?.();
      return;
    }
  };
}

/** Puts the row the address names (`#spec-<project>/<folder>`) at the top
 *  of the list's own box, under its headings, and the page at its top. The
 *  browser's own jump to the anchor scrolls every box the row sits in, the
 *  page included, so a row far down a long list took the tabs, the search
 *  and the headings above the screen. Where the box does not scroll by
 *  itself — a phone, where the page does — the browser's jump stands. */
export function placeNamedRow(doc: Document, win: Window): void {
  const hash = win.location?.hash;
  if (typeof hash !== "string" || !hash.startsWith("#spec-")) return;
  const id = decodeURIComponent(hash.slice(1));
  const row = doc.getElementById(id);
  const wrap = row?.closest(".tablewrap") as HTMLElement | null;
  if (!row || !wrap || wrap.scrollHeight <= wrap.clientHeight) return;
  const style = win.getComputedStyle(wrap);
  if (!/auto|scroll/.test(style.overflowY)) return;
  win.scrollTo(0, 0);
  const headings = Number.parseFloat(style.scrollPaddingTop) || 0;
  wrap.scrollTop += row.getBoundingClientRect().top - wrap.getBoundingClientRect().top - headings;
}
