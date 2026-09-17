// Spec 482: the project's own Schedule tab shares `renderScheduleForm`
// with the aggregate `/schedule` page (spec 468), and its own call site
// dropped `lang` entirely — so a project's "New job" form, its empty
// state and its table header stayed English on a Norwegian board even
// after the aggregate page's own fields were fixed.
import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectView } from "../../../../src/render";

const NAV = [{ label: "Projects", path: "/projects" }];

const project = (extra: Partial<ProjectView> = {}): ProjectView => ({
  name: "aide",
  manifest: { ok: false, error: "no manifest" },
  specs: [],
  ...extra,
});

describe("a project's own Schedule tab, in Norwegian", () => {
  test("the empty state and the New-job heading read Norwegian, not English", () => {
    const html = renderProjectPage(project(), { hasConfigFile: false, rows: [] }, null, "2026-09-17T00:00:00Z", NAV, {
      worktreeLinkCandidates: [],
      editing: false,
      tab: "schedule",
      lang: "nb",
    });
    expect(html).toContain("Ingenting er planlagt for dette prosjektet.");
    expect(html).toContain(">Ny jobb<");
    expect(html).not.toContain("Nothing is scheduled for this project.");
    expect(html).not.toContain(">New job<");
  });

  test("the entries table header reads Norwegian, not English", () => {
    const html = renderProjectPage(project(), { hasConfigFile: false, rows: [] }, null, "2026-09-17T00:00:00Z", NAV, {
      worktreeLinkCandidates: [],
      editing: false,
      tab: "schedule",
      lang: "nb",
      schedule: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true }],
    });
    expect(html).toContain("<th>Navn</th>");
    expect(html).toContain("<th>Cron</th>");
    expect(html).toContain("<th>Prompt</th>");
    expect(html).toContain("<th>Neste kjøring</th>");
    expect(html).not.toContain("<th>Name</th>");
    expect(html).not.toContain("<th>Next run</th>");
  });

  test("English is unchanged", () => {
    const html = renderProjectPage(project(), { hasConfigFile: false, rows: [] }, null, "2026-09-17T00:00:00Z", NAV, {
      worktreeLinkCandidates: [],
      editing: false,
      tab: "schedule",
      lang: "en",
    });
    expect(html).toContain("Nothing is scheduled for this project.");
    expect(html).toContain(">New job<");
  });
});
