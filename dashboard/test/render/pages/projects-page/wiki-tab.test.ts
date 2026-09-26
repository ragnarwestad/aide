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
    expect(html).toContain('href="/specs/j1?tab=steps"');
    expect(html).toContain('action="/api/queue/j1/cancel"');
    expect(html).not.toContain('action="/api/queue/projects/aide/wiki"');
  });

  test("a finished build says when, and the button builds again", () => {
    const html = page({ tab: "wiki", wikiBuild: { id: "j1", state: "done", finishedAt: "2026-09-26T10:00:00Z" } });
    expect(html).toContain("Last built 2026-09-26.");
    expect(html).toContain('action="/api/queue/projects/aide/wiki"');
    expect(html).not.toContain("/cancel");
  });

  test("a failed build says why, in the error's own sentence", () => {
    const html = page({ tab: "wiki", wikiBuild: { id: "j1", state: "failed", error: "the wiki build built nothing" } });
    expect(html).toMatch(/rowmsg failed[^"]*"[^>]*>[\s\S]*the wiki build built nothing/);
    expect(html).toContain('href="/specs/j1?tab=steps"');
  });
});

