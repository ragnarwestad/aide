import { describe, expect, test } from "bun:test";
import {
  renderDeleteSchedulePage,
  renderNewSchedulePage,
  renderScheduleDetailPage,
  renderSchedulePage,
} from "../../../src/render.ts";
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

  // Delete lives on the list since 2026-08-31, not on the entry's own
  // Edit page: reaching it there meant opening the thing you had
  // decided to be rid of.
  describe("Delete, at the right-hand end of the row", () => {
    const listed = (): string =>
      renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
        projects: ["aide"],
        rows: [
          {
            project: "aide",
            entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          },
        ],
      });

    test("comes after Run now, and the head row has a column for it", () => {
      const html = listed();
      expect(html.indexOf("Run now")).toBeLessThan(html.indexOf(">Delete<"));
      expect(html).toContain("<th>Enabled</th><th></th><th></th>");
    });

    test("Run now is the page's ordinary button, not a smaller one", () => {
      expect(listed()).not.toContain('class="btn small"');
    });

    test("the control is a link to the confirmation page — the no-script flow, unchanged", () => {
      expect(listed()).toContain('href="/schedule/aide/nightly-report/delete"');
    });

    // The dialog asked for the entry's name, typed back, until
    // 2026-09-08: its own heading asks the question and the form beside
    // the Delete button answers "no", so the press is the whole of
    // "yes".
    test("and opens that same confirmation over the list: a dialog with the two answers", () => {
      const html = listed();
      expect(html).toContain("<dialog class=\"confirmdialog\">");
      expect(html).toContain("data-delete-schedule");
      expect(html).toContain('action="/api/queue/schedule/aide/nightly-report/delete"');
      expect(html).toContain("Delete aide:nightly-report?");
      expect(html).not.toContain('data-confirm="nightly-report"');
      expect(html).toContain('<form method="dialog">');
    });
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
  // It made the reader type the entry's name back into a field until
  // 2026-09-08 — on a page whose own heading is that name. It asks the
  // question in a sentence now, with the two answers under it.
  test("explains every effect, asks in a sentence, and styles the button as destructive", () => {
    const html = renderDeleteSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      project: "aide",
      entryName: "nightly-report",
      token: "t0ken",
    });
    expect(html).toContain("nightly-report");
    expect(html.toLowerCase()).toContain("run history");
    expect(html).toContain("Are you sure you want to delete nightly-report? This cannot be undone.");
    expect(html).not.toContain("data-confirm=");
    expect(html).not.toContain('name="confirm"');
    expect(html).toContain('name="token" value="t0ken"');
    expect(html).toContain('class="btn danger"');
    expect(html).toContain(">Cancel</a>");
  });

  test("posts to the delete route beside the entry's own path", () => {
    const html = renderDeleteSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      project: "aide",
      entryName: "nightly-report",
    });
    expect(html).toContain('action="/api/queue/schedule/aide/nightly-report/delete"');
  });

  // Spec 296: the "Delete <name>" title sits beside ← Back, on one line.
  test("the title sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = renderDeleteSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      project: "aide",
      entryName: "nightly-report",
    });
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/schedule/aide/nightly-report">← Back</a>' +
        "<h1>Delete nightly-report</h1></div>",
    );
    expect(html.match(/<h1>Delete nightly-report<\/h1>/g)?.length ?? 0).toBe(1);
  });
});

describe("renderScheduleDetailPage (spec 296)", () => {
  test("the entry's name sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = renderScheduleDetailPage(NAV, "2026-08-30T00:00:00Z", {
      project: "aide",
      entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
      history: [],
    });
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/schedule">← Back</a><h1>nightly-report</h1></div>',
    );
    expect(html.match(/<h1>nightly-report<\/h1>/g)?.length ?? 0).toBe(1);
  });
});

describe("renderNewSchedulePage (spec 296)", () => {
  test("\"New job\" sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = renderNewSchedulePage(NAV, "2026-08-30T00:00:00Z", { projects: ["aide"] });
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/schedule">← Back</a><h1>New job</h1></div>',
    );
    expect(html.match(/<h1>New job<\/h1>/g)?.length ?? 0).toBe(1);
  });
});
