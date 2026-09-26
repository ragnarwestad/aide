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
