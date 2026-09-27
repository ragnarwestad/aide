// From the wiki's pages to the graph's own points and pairs. A point is a
// page the tab's list shows — `index.md` is never one of them, since the
// caller's own page list never carries it either (`project/wiki/read.ts`).
// A pair is two listed pages where at least one links to the other; the
// link itself is read the one place the wiki's schema defines it
// (`project/wiki/parse.ts`'s `pageLinks`), so this file never disagrees
// with what makes a link open on the tab.

import { pageLinks } from "../project/wiki/parse.ts";

export interface WikiGraphPage {
  page: string;
  title: string;
  /** The page's own text, front matter cut off. */
  body: string;
}

export interface WikiGraphPoint {
  page: string;
  title: string;
}

/** Indices into `points`, always `a < b` — a pair linked both ways is one
 *  of these, not two. */
export interface WikiGraphPair {
  a: number;
  b: number;
}

export interface WikiGraph {
  points: WikiGraphPoint[];
  pairs: WikiGraphPair[];
}

/** Every point index linked to `index`, directly — what AC-8's hover
 *  highlight calls "its own lines and the pages at their other ends". */
export function neighbors(index: number, pairs: readonly WikiGraphPair[]): Set<number> {
  const out = new Set<number>();
  for (const { a, b } of pairs) {
    if (a === index) out.add(b);
    else if (b === index) out.add(a);
  }
  return out;
}

/** The graph the tab draws: one point per page, one pair per linked couple.
 *  A link to a page not among `pages`, or to the page's own name, adds no
 *  pair; a link with a `#fragment` counts as a link to the page it names. */
export function buildWikiGraph(pages: readonly WikiGraphPage[]): WikiGraph {
  const points: WikiGraphPoint[] = pages.map(({ page, title }) => ({ page, title }));
  const indexOf = new Map(pages.map((p, i) => [p.page, i]));
  const seen = new Set<string>();
  const pairs: WikiGraphPair[] = [];
  pages.forEach((p, i) => {
    for (const target of pageLinks(p.body)) {
      const j = indexOf.get(target);
      if (j === undefined || j === i) continue;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a, b });
    }
  });
  return { points, pairs };
}
