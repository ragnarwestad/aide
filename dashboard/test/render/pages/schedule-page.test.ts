import { describe, expect, test } from "bun:test";
import { renderDeleteSchedulePage, renderSchedulePage } from "../../../src/render.ts";
import { renderScheduleList } from "../../../src/render/pages/schedule-page/list.ts";

const NAV = [{ label: "Projects", path: "/projects" }];

describe("Schedule page (spec 272, extended spec 276, reworked spec 278)", () => {
  test("rows from every allowed project appear together, in one table (criterion 1)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide", "atlasaurus"],
      rows: [
        { project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } },
        { project: "atlasaurus", entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true } },
      ],
    });
    expect(html).toContain("nightly-report");
    expect(html).toContain("weekly-check");
    expect(html.match(/<table class="list"/g)?.length ?? 0).toBe(1);
  });

  test("a row's Name cell reads project:name and still links to the entry's own detail page (criterion 2)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          lastState: "done",
          outputHref: "/schedule-output/aide/schedule-nightly-report/index.html",
        },
      ],
    });
    expect(html).toContain('href="/schedule/aide/nightly-report">aide:nightly-report</a>');
    expect(html).toContain("done");
    expect(html).toContain("/schedule-output/aide/schedule-nightly-report/index.html");
    // Deliberately NOT on the list row — it moved to the detail page.
    expect(html).not.toContain("0 3 * * *");
  });

  test("no project selector remains: no <select name=\"project\"> and no .scheduleprojects form (criterion 3)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
      rows: [{ project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } }],
    });
    expect(html).not.toContain('<select name="project">');
    expect(html).not.toContain('class="scheduleprojects"');
  });

  test("?q= narrows to rows whose project:name or prompt path matches, case-insensitively (criterion 4)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide", "atlasaurus"],
      rows: [
        { project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } },
        { project: "atlasaurus", entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true } },
      ],
      filter: { q: "AIDE" },
    });
    expect(html).toContain("nightly-report");
    expect(html).not.toContain("weekly-check");
  });

  test("each row carries an Enabled toggle and a Run-now button (acceptance criteria 14, 15)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
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
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
      rows: [{ project: "aide", entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: false } }],
    });
    expect(html).not.toMatch(/scheduleenabled" checked/);
  });

  test("the New job link points at /schedule/new, with no project segment (criterion 11)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
      rows: [],
    });
    expect(html).toContain('href="/schedule/new"');
    expect(html).toContain("New job");
  });

  test("given zero rows in any project, the exists-yet message appears, not the search-specific one (criterion 5)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", { projects: [], rows: [] });
    expect(html).toContain("No schedule entry exists yet.");
    expect(html).not.toContain("No schedule entry matches");
    expect(html).toContain("<html");
  });

  test("given rows that exist but a search term matches none, the no-match message names the term (criterion 6)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
      rows: [{ project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } }],
      filter: { q: "ghost" },
    });
    expect(html).toContain("No schedule entry matches &quot;ghost&quot;.");
    expect(html).not.toContain("No schedule entry exists yet.");
  });

  test("the default view (no ?sort=) orders rows by project:name ascending (criterion 7)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide", "atlasaurus"],
      rows: [
        { project: "atlasaurus", entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true } },
        { project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } },
      ],
    });
    expect(html.indexOf("aide:nightly-report")).toBeLessThan(html.indexOf("atlasaurus:weekly-check"));
  });

  test("sort links and the search-clear control carry no data-nav attribute (criterion 10)", () => {
    // `renderScheduleList` alone — `renderSchedulePage` wraps it in
    // `pageShell`, whose own site-wide nav TABS legitimately carry
    // `data-nav` and are not what this criterion is about.
    const html = renderScheduleList({
      projects: ["aide"],
      rows: [{ project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } }],
      filter: { q: "aide" },
    });
    expect(html).not.toContain("data-nav");
  });

  test("a row's name links to the entry's own detail page", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      projects: ["aide"],
      rows: [{ project: "aide", entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true } }],
    });
    expect(html).toContain('href="/schedule/aide/nightly-report"');
  });
});

describe("renderDeleteSchedulePage (spec 277, acceptance criterion 8)", () => {
  test("explains every effect, requires the exact name via typedConfirm, and styles the button as destructive", () => {
    const html = renderDeleteSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      project: "aide",
      entryName: "nightly-report",
      token: "t0ken",
    });
    expect(html).toContain("nightly-report");
    expect(html.toLowerCase()).toContain("run history");
    expect(html).toContain(`data-confirm="nightly-report"`);
    expect(html).toContain('name="confirm"');
    expect(html).toContain('name="token" value="t0ken"');
    expect(html).toContain('class="btn danger"');
  });

  test("posts to the delete route beside the entry's own path", () => {
    const html = renderDeleteSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      project: "aide",
      entryName: "nightly-report",
    });
    expect(html).toContain('action="/api/queue/schedule/aide/nightly-report/delete"');
  });
});
