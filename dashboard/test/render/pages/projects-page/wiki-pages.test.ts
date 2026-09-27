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
  { page: "charlie.md", title: "Charlie", summary: "Third by name.", state: "current", body: "" },
  { page: "alpha.md", title: "Alpha", summary: "Alpha's summary.", state: "changed", body: "" },
  { page: "bravo.md", title: "Bravo", summary: "", state: "unknown", body: "" },
  { page: "delta.md", title: "Delta", summary: "By hand.", state: "hand-written", body: "" },
];

describe("the Wiki tab's page list", () => {
  test("has one line per page, in the order given, each linking to its page on the tab (AC-1)", () => {
    const html = page({ wiki: { pages } });
    // The graph above the list links to the same pages, so this is scoped
    // to the list's own `<li>` — otherwise the graph's own links would
    // double the count.
    const hrefs = [...html.matchAll(/<li><a href="(\/projects\/aide\?tab=wiki&amp;page=[a-z-]+\.md)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/projects/aide?tab=wiki&amp;page=charlie.md", "/projects/aide?tab=wiki&amp;page=alpha.md",
      "/projects/aide?tab=wiki&amp;page=bravo.md", "/projects/aide?tab=wiki&amp;page=delta.md",
    ]);
    expect(html).toContain("Alpha's summary.");
  });

  test("each line says its state in a word (AC-4)", () => {
    const html = page({ wiki: { pages } });
    for (const word of ["Current", "Files changed", "Unknown", "By hand"]) expect(html).toContain(word);
  });

  test("the list carries no viewer mount (AC-2)", () => {
    expect(page({ wiki: { pages } })).not.toContain("spec-editor-host");
  });

  test("the build's status, its button and its log are on the Build tab, not beside the list (AC-3)", () => {
    const step = { step: "wiki", ok: true, costUsd: 0.1, costMeasured: true, terminalReason: "completed", logs: [{ by: "aide", lines: ["wrote"] }] };
    const html = page({
      wiki: { pages },
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
      wikiLog: { results: [step] },
    });
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).not.toContain('href="/projects/aide?tab=wiki&step=');
  });

  test("the Pages panel never carries the self-reload marker, running build or not, page open or not (AC-3)", () => {
    expect(page({ wiki: { pages }, script: "x", wikiBuild: { id: "j1", state: "running" } })).not.toContain("data-reload-every=");
    const open = { page: "alpha.md", state: "changed", text: "# Alpha\n" };
    expect(page({ wiki: { pages, open }, script: "x", wikiBuild: { id: "j1", state: "running" } })).not.toContain("data-reload-every=");
  });

  test("without a wiki the tab draws no pages block at all (AC-8)", () => {
    const html = page({});
    expect(html).not.toContain('class="wikipages"');
    expect(html).not.toContain("All pages");
  });
});

describe("an open page", () => {
  const open = { page: "alpha.md", state: "changed", text: "# Alpha\n\nSee [Bravo](/projects/aide?tab=wiki&page=bravo.md).\n" };

  test("is the viewer's pair: an empty mount and the raw text beside it, with a way back (AC-2)", () => {
    const html = page({ wiki: { pages, open } });
    expect(html).toContain('<div class="spec-editor-mount" id="spec-editor-host"></div>');
    expect(html).toMatch(/<pre class="specfile spec-editor-raw"># Alpha/);
    expect(html).toContain('href="/projects/aide?tab=wiki"');
    expect(html).toContain("All pages");
  });

  test("shows the page's state, and the list is not drawn under it (AC-4)", () => {
    const html = page({ wiki: { pages, open } });
    expect(html).toContain("Files changed");
    expect(html).not.toContain("Third by name.");
  });

  test("an open page carries no Build-tab action, cancel included (AC-3)", () => {
    const html = page({ wiki: { pages, open }, script: "x", wikiBuild: { id: "j1", state: "running" } });
    expect(html).not.toContain('action="/api/queue/j1/cancel"');
  });

  test("a page that is not on the branch says so and keeps the list (AC-5)", () => {
    const html = page({ wiki: { pages, open: { page: "nosuch.md", missing: true } } });
    expect(html).toContain("That page is not in the wiki.");
    expect(html).toContain("Third by name.");
    expect(html).not.toContain("spec-editor-host");
  });

  test("sends the shell the viewer script only when told (AC-2)", () => {
    expect(page({ wiki: { pages, open }, scriptSrc: "/spec-viewer.js" })).toContain('<script src="/spec-viewer.js">');
    expect(page({ wiki: { pages, open } })).not.toContain("/spec-viewer.js");
  });
});
