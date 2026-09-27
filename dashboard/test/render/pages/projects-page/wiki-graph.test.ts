// The Wiki tab is wired to the graph once: the points, the lines, an
// address equal to the page list's own, and none of it for a wiki with no
// pages (AC-1, AC-3, AC-17). The pairing and layout rules themselves are
// proven in test/wiki-graph, not here again.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectView } from "../../../../src/render";

const NAV = [{ label: "Projects", path: "/projects" }];
const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const page = (extra: Record<string, unknown> = {}) =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-26T00:00:00Z", NAV, {
    worktreeLinkCandidates: [],
    editing: false,
    tab: "wiki",
    ...extra,
  });

const pages = [
  { page: "alpha.md", title: "Alpha", summary: "", state: "current", body: "See [Bravo](bravo.md)." },
  { page: "bravo.md", title: "Bravo", summary: "", state: "current", body: "Back to [Alpha](alpha.md)." },
  { page: "charlie.md", title: "Charlie", summary: "", state: "current", body: "" },
];

describe("the Wiki tab's graph (AC-1)", () => {
  test("one point per page, none for index.md, and one line for the linked pair (AC-1)", () => {
    const html = page({ wiki: { pages } });
    expect(html.match(/class="wikinode"/g)).toHaveLength(3);
    expect(html.match(/class="wikiedge"/g)).toHaveLength(1);
    expect(html).toContain(">Alpha<");
    expect(html).toContain(">Bravo<");
    expect(html).toContain(">Charlie<");
    expect(html).not.toContain(">index<");
  });

  test("a point's address is the same one the page list gives that page (AC-3)", () => {
    const html = page({ wiki: { pages } });
    const graphHref = html.match(/<a class="wikinode" href="([^"]+)" data-node="0">/)?.[1];
    const listHref = html.match(/<li><a href="([^"]+)">Alpha<\/a>/)?.[1];
    expect(graphHref).toBe(listHref);
  });

  test("the graph sits above the page list", () => {
    const html = page({ wiki: { pages } });
    expect(html.indexOf("data-wikigraph")).toBeLessThan(html.indexOf('class="wikipages"'));
  });

  test("without a wiki the tab draws no graph at all (AC-17)", () => {
    expect(page({})).not.toContain("data-wikigraph");
  });

  test("a wiki with no page besides its index draws no graph (AC-17)", () => {
    expect(page({ wiki: { pages: [] } })).not.toContain("data-wikigraph");
  });
});
