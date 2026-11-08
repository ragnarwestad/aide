// The sortable column heading the /schedule list and an entry's runs list
// both draw, so the two sort the same way: a heading is a plain link to
// the column, the sorted one turned round, and the sort lives in the
// address.
import { ICON_CHEVRON } from "../../ui/components";
import { esc } from "../../ui/html.ts";

export type SortDir = "asc" | "desc";

export interface SortColumns {
  keys: readonly string[];
  /** The column an address with no known `sort` is sorted by. */
  fallback: string;
  /** Each column's direction on its first click — the one you almost
   *  always want first. */
  firstDir: Record<string, SortDir>;
}

/** The sort and direction the address asks for: an unknown sort is the
 *  fallback column, an unknown direction that column's first. */
export function resolveSort(cols: SortColumns, f: { sort?: string; dir?: string }): { sort: string; dir: SortDir } {
  const sort = cols.keys.includes(f.sort ?? "") ? f.sort! : cols.fallback;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : cols.firstDir[sort]!;
  return { sort, dir };
}

/** `path` with every key that has a value as a query, in the order given.
 *  UNESCAPED: the caller writing it into markup escapes it. */
export function queryHref(path: string, keys: Record<string, string | undefined>): string {
  const q = Object.entries(keys)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `${path}?${q}` : path;
}

/** One sortable `<th>`: a link to the column with the direction it turns
 *  to, `dir` passed as "" when it is the column's first; `aria-sort` on
 *  the sorted one; the chevron. `href` answers an UNESCAPED address, and
 *  this function escapes it once. */
export function sortHeading(
  cols: SortColumns,
  now: { sort: string; dir: SortDir },
  key: string,
  label: string,
  href: (sort: string, dir: string) => string,
): string {
  const on = key === now.sort;
  const first = cols.firstDir[key]!;
  // Clicking the column you are already sorted by turns it round.
  const next = on ? (now.dir === "asc" ? "desc" : "asc") : first;
  const linkCls = on ? (now.dir === "asc" ? "sortlink on asc" : "sortlink on") : first === "asc" ? "sortlink asc" : "sortlink";
  const aria = on ? ` aria-sort="${now.dir === "asc" ? "ascending" : "descending"}"` : "";
  return (
    `<th${aria}><a class="${linkCls}" href="${esc(href(key, next === first ? "" : next))}">` +
    `${esc(label)}${ICON_CHEVRON}</a></th>`
  );
}
