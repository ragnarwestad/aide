// The graph above the Wiki tab's page list: one point per page, one line
// per linked pair, laid out by `wiki-graph/layout.ts` at a settled first
// size — the browser script re-lays it out at the box's real width, and
// with script off or failed this first layout is what stays drawn.

import { buildWikiGraph } from "../../../wiki-graph/links.ts";
import { declutterLabels, labelSide, LABEL_GAP, settle, startPositions } from "../../../wiki-graph/layout.ts";
import { wikiPagePath } from "../../../project/wiki/parse.ts";
import type { WikiPageLine } from "../../../project/wiki/types.ts";
import { esc } from "../../ui/html.ts";

/** The server's own first layout, before the script measures the tab's
 *  real width (the recommended solution, decision 7). */
const WIDTH = 720;
const HEIGHT = 480;

/** The graph's markup, or nothing at all for a wiki with no page to draw
 *  (AC-6) — `index.md` is never among `pages`, since the list above it
 *  never carries it either. */
export function wikiGraph(project: string, pages: readonly WikiPageLine[]): string {
  if (pages.length === 0) return "";
  const { points, pairs } = buildWikiGraph(pages);
  const titles = points.map((p) => p.title);
  const settled = declutterLabels(settle(startPositions(points.length, WIDTH, HEIGHT), pairs, WIDTH, HEIGHT), titles, WIDTH, HEIGHT);

  const edges = pairs
    .map(({ a, b }) => {
      const from = settled[a]!;
      const to = settled[b]!;
      return `<line class="wikiedge" data-a="${a}" data-b="${b}" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}"/>`;
    })
    .join("");

  const nodes = points
    .map((point, i) => {
      const at = settled[i]!;
      const side = labelSide(at, WIDTH);
      const labelX = at.x + (side === "start" ? LABEL_GAP : -LABEL_GAP);
      return (
        `<a class="wikinode" href="${esc(wikiPagePath(project, point.page))}" data-node="${i}">` +
        `<circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="6"/>` +
        `<text x="${labelX.toFixed(1)}" y="${at.y.toFixed(1)}" text-anchor="${side}">${esc(point.title)}</text>` +
        `</a>`
      );
    })
    .join("");

  return `<svg class="wikigraph" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-wikigraph><g data-viewport>${edges}${nodes}</g></svg>`;
}
