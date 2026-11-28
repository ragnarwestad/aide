import type { RowSplit } from "./row-markup.ts";

/** How long a new row stays marked. */
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

/** Where a new row is brought to: its middle to the middle of what is in
 *  sight, so the rows above it show there is more; a row taller than half
 *  of that has its top brought to the top instead, or its title would be
 *  out of sight. The browser stops at the list's top, so a short list
 *  simply shows from its first row. */
export function scrollBlock(row: { top: number; bottom: number }, view: { top: number; bottom: number }): "center" | "start" {
  return row.bottom - row.top > (view.bottom - view.top) / 2 ? "start" : "center";
}

/** Rows marked as new, by key, with when the mark began. A redraw
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

/** A new job on the Jobs list is marked for `NOTICED_MS`, so the reader
 *  sees which rows are new, and the topmost is brought into sight when it
 *  is not (`scrollBlock`); a row already in sight leaves the page where it
 *  is. A job the filters hide is not in the list, so it moves nothing. */
export function showAddedRow(body: Element, keys: readonly string[], now = Date.now()): void {
  for (const [key, since] of noticed) {
    if (now - since >= NOTICED_MS) noticed.delete(key);
    else mark(body, key, since, now);
  }
  if (!keys.length || !body.querySelector('table.speclist[data-list="jobs"]')) return;
  const rows = keys.map((key) => body.ownerDocument.getElementById(key)).filter((row): row is HTMLElement => !!row);
  if (!rows.length) return;
  for (const row of rows) noticeFor(body, row.id, now);
  const first = rows[0]!;
  if (typeof first.getBoundingClientRect !== "function") return;
  const box = first.getBoundingClientRect();
  const sight = view(body);
  if (wholeInSight(box, sight)) return;
  first.scrollIntoView?.({ block: scrollBlock(box, sight) });
}

function noticeFor(body: Element, key: string, now: number): void {
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
