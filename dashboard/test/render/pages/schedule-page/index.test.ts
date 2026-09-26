import { beforeEach, describe, expect, test } from "bun:test";
import { renderSchedulePage } from "../../../../src/render";
import { clearCheckoutFaults } from "../../../../src/render/ui/checkout-faults.ts";
import { renderScheduleList } from "../../../../src/render/pages/schedule-page/list.ts";

// The page's header shows the board's checkout faults, which live in the
// process: a board another test file started in this process can leave one.
beforeEach(() => clearCheckoutFaults());

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

  test("a row's Name cell reads project:name, and it and the whole row link to the project's own Schedule tab (criterion 2, spec 468)", () => {
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
    expect(html).toContain('<tr data-row-href="/projects/aide?tab=schedule">');
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

  // The list shows and links: the switch, Run now and Delete are on the
  // project's own Schedule tab (`controls.test.ts`).
  test("a row shows whether the entry is enabled, as text, and holds no control that changes it", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "on", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
        {
          project: "aide",
          entry: { name: "off", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: false },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
    });
    expect(html).toContain("<td>Yes</td>");
    expect(html).toContain("<td>No</td>");
    for (const control of ["scheduleenabled", "schedulerun", "data-delete-schedule", "/api/queue/schedule/"]) {
      expect(html).not.toContain(control);
    }
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

  test("the flag sits in the unlisted entry's Name cell and links to the entry's edit page", () => {
    const html = list({ modelNames: ["Sonnet", "Opus"] });
    expect(html.match(/rowmsg failed/g)?.length).toBe(1);
    const cell = html.match(/<td><a href="[^"]*">aide:retired-one<\/a>[\s\S]*?<\/td>/)?.[0] ?? "";
    expect(cell).toContain("retired");
    expect(cell).toContain("Sonnet, Opus");
    expect(cell).toContain('href="/schedule/aide/retired-one/edit"');
  });

  test("no model list passed draws no flag", () => {
    expect(list({})).not.toContain("is not one the queue offers");
  });
});
