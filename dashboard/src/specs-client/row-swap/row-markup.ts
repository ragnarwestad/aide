import { SPEC_HEAD_CLASS } from "../../page-contract.ts";

/** One spec's rows, keyed by the anchor id the server already puts on
 *  its head row (`rowAnchorId`, `render/specs-list.ts`). */
export interface RowGroup {
  key: string;
  html: string;
}

/** The fetched row list, cut where the diff can work on it: everything
 *  up to and including `<tbody>`, one entry per spec, and everything
 *  from `</tbody>` on. Concatenating the three gives back the string it
 *  was cut from, character for character. */
export interface RowSplit {
  prefix: string;
  groups: RowGroup[];
  suffix: string;
}

/** The class the renderer puts on a spec's first row, and the only
 *  thing that says where one spec's rows end and the next spec's begin.
 *  Named once, and used both to cut the fetched markup up and to walk
 *  the page's own rows — two answers to that question could disagree. */
const OPEN_TBODY = "<tbody>";
const CLOSE_TBODY = "</tbody>";

/** The fetched markup as groups (`holdsSpec`: the spec is drawn in its row), or `null` when it cannot be accounted
 *  for exactly — no table, more than one, a row before the first spec
 *  (the empty and no-match states are one such row), or two specs
 *  wearing one id. `null` means "redraw the old way": failing open to
 *  the behaviour that has shipped for a year beats a diff that might be
 *  wrong about which rows are whose. */
export function splitGroups(html: string, holdsSpec = false): RowSplit | null {
  const open = html.indexOf(OPEN_TBODY);
  const close = html.lastIndexOf(CLOSE_TBODY);
  if (open === -1 || close === -1 || close < open) return null;
  const start = open + OPEN_TBODY.length;
  // A second table would put rows outside the range walked below. The
  // answer that has the open spec in its row has tables of its own inside
  // that row, and is one spec's rows alone. A group's card holds a table
  // of its own inside its one row too, so a table inside a row is not a
  // second one.
  const content = html.slice(start, close);
  const Parser = document.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(html, "text/html");
  const bodies = Array.from(parsed.querySelectorAll("tbody")).filter((b) => !b.parentElement?.closest("tr"));
  if (!bodies.length || (!holdsSpec && bodies.length !== 1)) return null;
  const heads = Array.from(bodies[0]!.children).filter(isRowHead);
  const at: { key: string; index: number }[] = [];
  const positions = new Map<string, number>();
  for (const tag of content.matchAll(/<tr\b[^>]*>/g)) {
    const id = /\bid=["']([^"']+)["']/.exec(tag[0])?.[1];
    if (id && !positions.has(id)) positions.set(id, tag.index!);
  }
  for (const head of heads) {
    const key = head.id;
    const index = positions.get(key);
    if (!key || index === undefined) return null;
    at.push({ key, index });
  }
  // Every row belongs to a spec or a group heading. The first heading
  // starting anywhere but the very beginning means
  // something else is in there.
  if (!at.length || at[0]!.index !== 0) return null;
  const groups: RowGroup[] = [];
  const seen: Record<string, true> = {};
  for (let i = 0; i < at.length; i++) {
    const key = at[i]!.key;
    if (seen[key]) return null; // no unique anchor to reach it by
    seen[key] = true;
    groups.push({ key, html: content.slice(at[i]!.index, at[i + 1]?.index ?? content.length) });
  }
  return { prefix: html.slice(0, start), groups, suffix: html.slice(close) };
}

export const isSpecHead = (el: Element): boolean =>
  ` ${el.className} `.indexOf(` ${SPEC_HEAD_CLASS} `) !== -1;
export const isRowHead = (el: Element): boolean => isSpecHead(el) || el.hasAttribute("data-spec-group");

