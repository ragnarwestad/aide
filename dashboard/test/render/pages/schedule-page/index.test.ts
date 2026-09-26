import { describe, expect, test } from "bun:test";
import { renderSchedulePage } from "../../../../src/render";
import { renderScheduleList } from "../../../../src/render/pages/schedule-page/list.ts";

const NAV = [{ label: "Projects", path: "/projects" }];

describe("Schedule page (spec 272, extended spec 276, reworked spec 278)", () => {
  test("rows from every allowed project appear together, in one table (criterion 1)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
        {
          project: "atlasaurus",
          entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
          projectScheduleHref: "/projects/atlasaurus?tab=schedule",
        },
      ],
    });
    expect(html).toContain("nightly-report");
    expect(html).toContain("weekly-check");
    expect(html.match(/<table class="list"/g)?.length ?? 0).toBe(1);
  });

  test("a row's Name cell reads project:name and links to the project's own Schedule tab (criterion 2, spec 468)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          lastState: "done",
          outputHref: "/schedule/aide/nightly-report#report",
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
    });
    expect(html).toContain('href="/projects/aide?tab=schedule">aide:nightly-report</a>');
    expect(html).toContain("done");
    expect(html).toContain('href="/schedule/aide/nightly-report#report"');
    // Deliberately NOT on the list row — it moved to the detail page.
    expect(html).not.toContain("0 3 * * *");
  });

  test("?q= narrows to rows whose project:name or prompt path matches, case-insensitively (criterion 4)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
        {
          project: "atlasaurus",
          entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
          projectScheduleHref: "/projects/atlasaurus?tab=schedule",
        },
      ],
      filter: { q: "AIDE" },
    });
    expect(html).toContain("nightly-report");
    expect(html).not.toContain("weekly-check");
  });

  test("each row carries an Enabled toggle and a Run-now button (acceptance criteria 14, 15)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
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
        rows: [
          {
            project: "aide",
            entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
            projectScheduleHref: "/projects/aide?tab=schedule",
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

    test("the control is a button, not a link — no delete page behind it (AC-2)", () => {
      const html = listed();
      expect(html).toContain('<button type="button" class="btn danger" data-delete-schedule aria-label="Delete nightly-report">Delete</button>');
      expect(html).not.toContain('href="/schedule/aide/nightly-report/delete"');
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

    test("the dialog's answers share one row: OK (red) first, Cancel plain, no Delete button (AC-1, AC-2, AC-3)", () => {
      const box = listed().match(/<dialog class="confirmdialog">[\s\S]*?<\/dialog>/)![0];
      expect(box.match(/class="dialogactions"/g)).toHaveLength(1);
      expect(box).toMatch(/<div class="dialogactions"><form method="post"[^>]*class="scheduledeleteform">/);
      expect(box).toMatch(/btn danger[^>]*>[\s\S]*?OK[\s\S]*?<\/form><form method="dialog"><button class="btn" type="submit">Cancel<\/button><\/form><\/div>/);
      expect(box).not.toContain(">Delete</button>");
    });
  });

  test("a disabled entry's checkbox is unchecked", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: false },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
    });
    expect(html).not.toMatch(/scheduleenabled" checked/);
  });

  test("given zero rows in any project, the exists-yet message appears, not the search-specific one (criterion 5)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", { rows: [] });
    expect(html).toContain("No schedule entry exists yet.");
    expect(html).not.toContain("No schedule entry matches");
    expect(html).toContain("<html");
  });

  test("given rows that exist but a search term matches none, the no-match message names the term (criterion 6)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
      filter: { q: "ghost" },
    });
    expect(html).toContain("No schedule entry matches &quot;ghost&quot;.");
    expect(html).not.toContain("No schedule entry exists yet.");
  });

  test("the default view (no ?sort=) orders rows by project:name ascending (criterion 7)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "atlasaurus",
          entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
          projectScheduleHref: "/projects/atlasaurus?tab=schedule",
        },
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
    });
    expect(html.indexOf("aide:nightly-report")).toBeLessThan(html.indexOf("atlasaurus:weekly-check"));
  });

  test("sort links and the search-clear control carry no data-nav attribute (criterion 10)", () => {
    // `renderScheduleList` alone — `renderSchedulePage` wraps it in
    // `pageShell`, whose own site-wide nav TABS legitimately carry
    // `data-nav` and are not what this criterion is about.
    const html = renderScheduleList({
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
      filter: { q: "aide" },
    });
    expect(html).not.toContain("data-nav");
  });

  test("a row's name links to the project's own Schedule tab (spec 468, criterion 5)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
    });
    expect(html).toContain('href="/projects/aide?tab=schedule"');
  });
});

describe("Schedule list: the refusal slot and the model flag (spec 494)", () => {
  const row = (name: string, model?: string) => ({
    project: "aide",
    entry: { name, cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true, ...(model ? { model } : {}) },
    projectScheduleHref: "/projects/aide?tab=schedule",
  });
  const list = (o: object) =>
    renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [row("retired-one", "retired"), row("listed", "Sonnet"), row("lower", "sonnet"), row("plain")],
      ...o,
    });

  test("?error= fills the slot; without it the slot is there and empty", () => {
    expect(list({ error: "Run now was refused for aide:x: boom" })).toContain(
      '<p class="refused rowmsg failed" aria-live="polite">Run now was refused for aide:x: boom</p>',
    );
    expect(list({})).toContain('<p class="refused" aria-live="polite"></p>');
  });

  test("the flag sits in the unlisted entry's Name cell and links to the entry's own page", () => {
    const html = list({ modelNames: ["Sonnet", "Opus"] });
    expect(html.match(/rowmsg failed/g)?.length).toBe(1);
    const cell = html.match(/<td><a href="[^"]*">aide:retired-one<\/a>[\s\S]*?<\/td>/)?.[0] ?? "";
    expect(cell).toContain("retired");
    expect(cell).toContain("Sonnet, Opus");
    expect(cell).toContain('href="/schedule/aide/retired-one"');
  });

  test("no model list passed draws no flag", () => {
    expect(list({})).not.toContain("is not one the queue offers");
  });
});
