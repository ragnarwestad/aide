import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectView } from "../../../../src/render";

const NAV = [{ label: "Projects", path: "/projects" }];
const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const page = (extra: Record<string, unknown> = {}) =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-26T00:00:00Z", NAV, {
    worktreeLinkCandidates: [],
    editing: false,
    ...extra,
  });

describe("the project page's Wiki tab (AC-1)", () => {
  test("the tab has a form posting to the project's wiki route with a build button", () => {
    const html = page({ tab: "wiki" });
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).toMatch(/<button[^>]*>[^<]*Build wiki[^<]*<\/button>/);
  });

  test("a refusal is shown on the tab and the form stays", () => {
    const html = page({ tab: "wiki", wikiError: "wiki on wiki-aide is already queued" });
    expect(html).toContain("on wiki-aide is already queued");
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
  });

  test("the button reads in the page's language", () => {
    const html = page({ tab: "wiki", lang: "nb" });
    expect(html).toContain("Bygg wiki");
    expect(html).not.toContain("Build wiki");
  });
});

describe("the Wiki tab shows the latest build", () => {
  test("a running build: its log, Cancel, and no second Build button", () => {
    const html = page({ tab: "wiki", wikiBuild: { id: "j1", state: "running" } });
    expect(html).toContain('action="/api/queue/j1/cancel"');
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).toMatch(/class="rowmsg waiting">.*?<span><span class="badge b-running"[^>]*data-icon="loader"/);
  });

  test("a finished build says when, and the button builds again", () => {
    const html = page({ tab: "wiki", wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" } });
    expect(html).toContain("Last built 2026-09-26.");
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).not.toContain("/cancel");
  });

  test("a failed build says why, in the error's own sentence", () => {
    const html = page({ tab: "wiki", wikiBuild: { id: "j1", state: "failed", error: "the wiki build built nothing" } });
    expect(html).toMatch(/rowmsg failed[^"]*"[^>]*>[\s\S]*the wiki build built nothing/i);
  });
});

// The build's log is on this tab, not behind a link to a page of its own
// that nothing else in the board leads to.
describe("the Wiki tab carries the latest build's log", () => {
  const step = { step: "wiki", ok: true, costUsd: 0.1, costMeasured: true, terminalReason: "completed", logs: ["wrote landing.md"] };

  test("its step is listed, and opening it stays on the Wiki tab", () => {
    const html = page({
      tab: "wiki",
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
      wikiLog: { results: [step] },
    });
    expect(html).toContain('href="/projects/aide?tab=wiki&step=');
    expect(html).not.toContain("/jobs/");
  });

  test("an opened step shows the same strip as the spec page's Logs tab, on the tab the address names (AC-8)", () => {
    const html = page({
      tab: "wiki",
      wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" },
      wikiLog: { results: [step], step: "0", steptab: "files" },
    });
    const tabs = (html.match(/<a class="tab"[^>]*>[^<]*<\/a>/g) ?? []).filter((a) => a.includes("steptab="));
    expect(tabs.map((a) => a.replace(/<[^>]+>/g, ""))).toEqual(["Log", "Changed files", "Errors"]);
    expect(tabs[1]).toContain('aria-current="true"');
    expect(tabs[1]).toContain('href="/projects/aide?tab=wiki&step=0&steptab=files"');
  });

  test("with no build yet there is no log", () => {
    expect(page({ tab: "wiki" })).not.toContain("No step has finished yet");
  });
});

// A running build's log kept still until the reader reloaded the page.
describe("the Wiki tab keeps up with a running build by itself", () => {
  test("while a build runs, the tab reloads itself", () => {
    const html = page({ tab: "wiki", script: "x", wikiBuild: { id: "j1", state: "running" } });
    expect(html).toContain("data-reload-every=");
  });

  test("once the build is over, it holds still", () => {
    const html = page({ tab: "wiki", script: "x", wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" } });
    expect(html).not.toContain("data-reload-every=");
  });
});

