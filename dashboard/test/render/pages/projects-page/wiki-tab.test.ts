import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectView } from "../../../../src/render";

const NAV = [{ label: "Projects", path: "/projects" }];
const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const page = (extra: Record<string, unknown> = {}) =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-26T00:00:00Z", NAV, {
    worktreeLinkCandidates: [],
    editingGroup: null,
    ...extra,
  });

describe("the project page's Wiki tab, Build panel (AC-4)", () => {
  test("the tab has a form posting to the project's wiki route with a build button", () => {
    const html = page({ tab: "wiki", wikiTab: "build" });
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).toMatch(/<button[^>]*>[^<]*Build wiki[^<]*<\/button>/);
  });

  test("a refusal is shown on the tab and the form stays", () => {
    const html = page({ tab: "wiki", wikiTab: "build", wikiError: "wiki on wiki-aide is already queued" });
    expect(html).toContain("on wiki-aide is already queued");
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
  });

  test("the button reads in the page's language", () => {
    const html = page({ tab: "wiki", wikiTab: "build", lang: "nb" });
    expect(html).toContain("Bygg wiki");
    expect(html).not.toContain("Build wiki");
  });
});

describe("the Wiki tab's Build panel shows the latest build", () => {
  test("a running build: its log, Cancel, and no second Build button", () => {
    const html = page({ tab: "wiki", wikiTab: "build", wikiBuild: { id: "j1", state: "running" } });
    expect(html).toContain('action="/api/queue/j1/cancel"');
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).toMatch(/class="rowmsg waiting">.*?<span><span class="badge b-running"[^>]*data-icon="loader"/);
  });

  test("a finished build says when, and the button builds again", () => {
    const html = page({ tab: "wiki", wikiTab: "build", wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" } });
    expect(html).toContain("Last built 2026-09-26.");
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).not.toContain("/cancel");
  });

  test("a failed build says why, in the error's own sentence", () => {
    const html = page({ tab: "wiki", wikiTab: "build", wikiBuild: { id: "j1", state: "failed", error: "the wiki build built nothing" } });
    expect(html).toMatch(/rowmsg failed[^"]*"[^>]*>[\s\S]*the wiki build built nothing/i);
  });
});

// The build's log is on this tab, not behind a link to a page of its own
// that nothing else in the board leads to.
describe("the Wiki tab's Build panel carries the latest build's log (AC-4)", () => {
  const step = { step: "wiki", ok: true, costUsd: 0.1, costMeasured: true, terminalReason: "completed", logs: [{ by: "aide", lines: ["wrote landing.md"] }] };

  test("its step is listed, and opening it stays on the Build tab", () => {
    const html = page({
      tab: "wiki",
      wikiTab: "build",
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
      wikiLog: { results: [step] },
    });
    expect(html).toContain('href="/projects/aide?tab=wiki&amp;wikitab=build&step=');
    expect(html).not.toContain("/jobs/");
  });

  test("an opened step shows the same strip as the spec page's Logs tab, on the tab the address names (AC-10)", () => {
    const html = page({
      tab: "wiki",
      wikiTab: "build",
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
      wikiLog: { results: [step], step: "0", steptab: "files" },
    });
    const tabs = (html.match(/<a class="tab"[^>]*>[^<]*<\/a>/g) ?? []).filter((a) => a.includes("steptab="));
    expect(tabs.map((a) => a.replace(/<[^>]+>/g, ""))).toEqual(["Log", "Changed files", "Errors"]);
    expect(tabs[1]).toContain('aria-current="true"');
    expect(tabs[1]).toContain('href="/projects/aide?tab=wiki&amp;wikitab=build&step=0&steptab=files"');
  });

  test("an opened step draws its parts under the separators of the Logs tab (AC-10)", () => {
    const parts = [{ by: "aide-before", lines: ["10:45:08 +0s fetching main"] }, { by: "ai", lines: ["wrote landing.md"] }];
    const html = page({
      tab: "wiki",
      wikiTab: "build",
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
      wikiLog: { results: [{ ...step, logs: parts, aiModel: "Claude Sonnet" }], step: "0" },
    });
    expect(html.match(/— Aide: preparing —/g)).toHaveLength(1);
    expect(html).toContain("— AI (Claude Sonnet) —");
  });

  test("with no build yet there is no log", () => {
    expect(page({ tab: "wiki", wikiTab: "build" })).not.toContain("No step has finished yet");
  });
});

// A running build's log kept still until the reader reloaded the page.
describe("the Wiki tab's Build panel keeps up with a running build by itself", () => {
  test("while a build runs, the tab reloads itself", () => {
    const html = page({ tab: "wiki", wikiTab: "build", script: "x", wikiBuild: { id: "j1", state: "running" } });
    expect(html).toContain("data-reload-every=");
  });

  test("once the build is over, it holds still", () => {
    const html = page({ tab: "wiki", wikiTab: "build", script: "x", wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" } });
    expect(html).not.toContain("data-reload-every=");
  });
});

// The Pages/Graph/Build sub-tab bar itself: which one opens by default,
// which one the address picks, and the Build tab's own running-state label.
describe("the Wiki tab's Pages/Graph/Build sub-tab bar (AC-1, AC-5, AC-6, AC-10)", () => {
  const wikiPages = [{ page: "alpha.md", title: "Alpha", summary: "", state: "current", body: "" }];

  const subTabBar = (html: string): string => html.match(/<nav class="tabbar subtabs" data-wikisubtabs>(.*?)<\/nav>/s)?.[1] ?? "";
  const subTabLabels = (html: string): string[] =>
    [...subTabBar(html).matchAll(/<a class="tab"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]!);

  test("with no wikitab in the address, the tab opens on Pages (AC-1)", () => {
    const html = page({ tab: "wiki", wiki: { pages: wikiPages } });
    expect(html).toContain('class="wikipages"');
    expect(html).not.toContain("data-wikigraph");
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
  });

  test("the bar names Pages, Graph and Build, in that order (AC-1)", () => {
    expect(subTabLabels(page({ tab: "wiki", wiki: { pages: wikiPages } }))).toEqual(["Pages", "Graph", "Build"]);
  });

  test("wikitab=graph opens Graph, wikitab=build opens Build (AC-5)", () => {
    expect(page({ tab: "wiki", wiki: { pages: wikiPages }, wikiTab: "graph" })).toContain("data-wikigraph");
    expect(page({ tab: "wiki", wiki: { pages: wikiPages }, wikiTab: "build" })).toContain('action="/api/queue/projects/aide/wiki"');
  });

  test("an unknown wikitab value falls back to Pages (AC-5)", () => {
    expect(page({ tab: "wiki", wiki: { pages: wikiPages }, wikiTab: "nonsense" })).toContain('class="wikipages"');
  });

  test("an open page opens on Pages even when the address asks for Build (AC-5)", () => {
    const open = { page: "alpha.md", state: "current" as const, text: "# Alpha\n" };
    const html = page({ tab: "wiki", wiki: { pages: wikiPages, open }, wikiTab: "build" });
    expect(html).toContain("spec-editor-host");
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
  });

  test("the Build tab's own label says so while a build is queued or running, whichever sub-tab is open (AC-6)", () => {
    for (const wikiTab of ["pages", "graph", "build"] as const) {
      for (const state of ["queued", "running"]) {
        const html = page({ tab: "wiki", wiki: { pages: wikiPages }, wikiTab, wikiBuild: { id: "j1", state } });
        expect(subTabLabels(html)).toContain("Build (running)");
      }
    }
  });

  test("the Build tab's own label reads plain \"Build\" once nothing is queued or running (AC-6)", () => {
    const html = page({
      tab: "wiki", wiki: { pages: wikiPages },
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
    });
    expect(subTabLabels(html)).toContain("Build");
  });

  test("a project with no wiki draws no sub-tab bar, and shows the Build panel alone (AC-10)", () => {
    const html = page({ tab: "wiki", wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" } });
    expect(html).not.toContain("data-wikisubtabs");
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
  });
});

