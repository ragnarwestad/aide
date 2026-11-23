import type { RowSplit } from "./row-markup.ts";

/** The rows a redraw adds to the Jobs list, top first: a head row whose
 *  key the list did not have before. A row that only changed or moved is
 *  not one, and the first redraw after a page load has nothing to compare
 *  with, so it adds none. */
export function addedRowKeys(before: RowSplit | null, after: RowSplit | null): string[] {
  if (!before || !after) return [];
  const had = new Set(before.groups.map((g) => g.key));
  return after.groups.map((g) => g.key).filter((key) => !had.has(key));
}

/** A new job on the Jobs list is scrolled into sight, the topmost when
 *  several arrive at once; a row already in sight leaves the page where
 *  it is. A job the filters hide is not in the list, so it moves nothing. */
export function showAddedRow(body: Element, keys: readonly string[]): void {
  if (!keys.length || !body.querySelector('table.speclist[data-list="jobs"]')) return;
  const row = body.ownerDocument.getElementById(keys[0]!);
  row?.scrollIntoView?.({ block: "nearest" });
}
