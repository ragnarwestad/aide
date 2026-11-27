import type { RowSplit } from "./row-markup.ts";

/** How long a row the page scrolled to on its own stays marked. */
export const NOTICED_MS = 5000;

/** The rows a redraw adds to the Jobs list, top first: a head row whose
 *  key the list did not have before, standing above the lowest row it
 *  kept. A row that only changed or moved is not one; nor is an older job
 *  the loaded list takes in at its foot when rows above it leave. The
 *  first redraw after a page load has nothing to compare with, so it adds
 *  none. */
export function addedRowKeys(before: RowSplit | null, after: RowSplit | null): string[] {
  if (!before || !after) return [];
  const had = new Set(before.groups.map((g) => g.key));
  const keys = after.groups.map((g) => g.key);
  const lowestKept = keys.findLastIndex((key) => had.has(key));
  return keys.slice(0, Math.max(lowestKept, 0)).filter((key) => !had.has(key));
}

/** Whether a row lies wholly inside the part of the list on screen. */
export function wholeInSight(row: { top: number; bottom: number }, view: { top: number; bottom: number }): boolean {
  return row.top >= view.top && row.bottom <= view.bottom;
}

/** Rows marked as scrolled to, by key, with when the mark began. A redraw
 *  may draw the row afresh, so the mark is put back, carrying on from
 *  where it was, until its time is up. */
const noticed = new Map<string, number>();

function headAndItsRows(head: Element): Element[] {
  const rows = [head];
  for (let next = head.nextElementSibling; next && !next.id && !next.classList.contains("specgap"); next = next.nextElementSibling) rows.push(next);
  return rows;
}

function mark(body: Element, key: string, since: number, now: number): void {
  const head = body.ownerDocument.getElementById(key);
  if (!head) return;
  for (const row of headAndItsRows(head)) {
    row.classList.add("noticed");
    (row as HTMLElement).style?.setProperty("--noticed-delay", `-${now - since}ms`);
  }
}

function view(body: Element): { top: number; bottom: number } {
  const wrap = body.querySelector(".tablewrap") as HTMLElement | null;
  const scrolls = !!wrap && wrap.scrollHeight > wrap.clientHeight && /auto|scroll/.test(getComputedStyle(wrap).overflowY);
  if (scrolls) {
    const rect = wrap!.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }
  return { top: 0, bottom: body.ownerDocument.defaultView?.innerHeight ?? 0 };
}

/** A new job on the Jobs list is scrolled into sight, the topmost when
 *  several arrive at once; a row already in sight leaves the page where
 *  it is. A job the filters hide is not in the list, so it moves nothing.
 *  A row the page scrolled to is marked for `NOTICED_MS`, so the reader
 *  sees which row made it move. */
export function showAddedRow(body: Element, keys: readonly string[], now = Date.now()): void {
  for (const [key, since] of noticed) {
    if (now - since >= NOTICED_MS) noticed.delete(key);
    else mark(body, key, since, now);
  }
  if (!keys.length || !body.querySelector('table.speclist[data-list="jobs"]')) return;
  const row = body.ownerDocument.getElementById(keys[0]!);
  if (!row) return;
  if (typeof row.getBoundingClientRect === "function" && wholeInSight(row.getBoundingClientRect(), view(body))) return;
  row.scrollIntoView?.({ block: "nearest" });
  const key = row.id;
  noticed.set(key, now);
  mark(body, key, now, now);
  setTimeout(() => {
    if (noticed.get(key) !== now) return;
    noticed.delete(key);
    const head = body.ownerDocument.getElementById(key);
    for (const r of head ? headAndItsRows(head) : []) {
      r.classList.remove("noticed");
      (r as HTMLElement).style?.removeProperty("--noticed-delay");
    }
  }, NOTICED_MS);
}
