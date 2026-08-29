import { describe, expect, test } from "bun:test";
import { renderSchedulePage } from "../../../src/render.ts";

const NAV = [{ label: "Projects", path: "/projects" }];

describe("Schedule page (spec 272, extended spec 276)", () => {
  test("the project selector lists every allowed project, and the selected one is marked", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      projects: ["aide", "atlasaurus"],
      selectedProject: "atlasaurus",
      rows: [],
    });
    expect(html).toContain('<option value="aide">aide</option>');
    expect(html).toContain('<option value="atlasaurus" selected>atlasaurus</option>');
  });

  test("a row shows the name, next run, last state and output link, but not the cron itself (spec 276)", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      projects: ["aide"],
      selectedProject: "aide",
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          lastState: "done",
          outputHref: "/schedule-output/aide/schedule-nightly-report/index.html",
        },
      ],
    });
    expect(html).toContain("nightly-report");
    expect(html).toContain("done");
    expect(html).toContain("/schedule-output/aide/schedule-nightly-report/index.html");
    // Deliberately NOT on the list row — it moved to the detail page.
    expect(html).not.toContain("0 3 * * *");
  });

  test("each row carries an Enabled toggle and a Run-now button (acceptance criteria 14, 15)", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      projects: ["aide"],
      selectedProject: "aide",
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
        },
      ],
    });
    expect(html).toContain('data-post-to="/api/queue/schedule/aide/nightly-report/enabled"');
    expect(html).toContain('checked');
    expect(html).toContain('action="/api/queue/schedule/aide/nightly-report/run"');
    expect(html).toContain("Run now");
  });

  test("a disabled entry's checkbox is unchecked", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      projects: ["aide"],
      selectedProject: "aide",
      rows: [{ project: "aide", entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: false } }],
    });
    expect(html).not.toMatch(/scheduleenabled" checked/);
  });

  test("the New job button links to the selected project's own new-entry page", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      projects: ["aide"],
      selectedProject: "aide",
      rows: [],
    });
    expect(html).toContain('href="/schedule/aide/new"');
    expect(html).toContain("New job");
  });

  test("given zero rows, the none-yet message appears and the page still renders", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", { projects: [], rows: [] });
    expect(html.toLowerCase()).toContain("no project has a schedule entry yet");
    expect(html).toContain("<html");
  });

  test("a row's name links to the entry's own detail page", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      projects: ["aide"],
      selectedProject: "aide",
      rows: [{ project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } }],
    });
    expect(html).toContain('href="/schedule/aide/nightly-report"');
  });
});
