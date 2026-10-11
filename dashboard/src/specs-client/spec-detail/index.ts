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
