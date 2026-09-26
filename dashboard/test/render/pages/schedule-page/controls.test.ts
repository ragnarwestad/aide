// A schedule entry's controls — the Enabled switch, Run now, Edit and
// Delete — drawn on the entry's row of its project's own Schedule tab.
import { describe, expect, test } from "bun:test";
import { scheduleControlCells } from "../../../../src/render/pages/schedule-page/controls.ts";
import { renderProjectPage, type ProjectView } from "../../../../src/render";

const entry = (enabled = true) => ({ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled });

describe("scheduleControlCells", () => {
  test("the switch posts to the entry's enabled route and shows its state; Run now posts to its run route", () => {
    const html = scheduleControlCells("aide", entry());
    expect(html).toContain('data-post-to="/api/queue/schedule/aide/nightly-report/enabled"');
    expect(html).toMatch(/scheduleenabled" checked/);
    expect(html).toContain('action="/api/queue/schedule/aide/nightly-report/run"');
    expect(html).toContain("Run now");
    expect(scheduleControlCells("aide", entry(false))).not.toMatch(/scheduleenabled" checked/);
  });

  test("Edit sits between Run now and Delete, and opens the entry's own edit page", () => {
    const html = scheduleControlCells("aide", entry());
    const edit = html.indexOf('<a class="btn" href="/schedule/aide/nightly-report/edit">');
    expect(edit).toBeGreaterThan(html.indexOf("Run now"));
    expect(edit).toBeLessThan(html.indexOf("data-delete-schedule"));
  });

  test("Delete is a button that opens a dialog, no page behind it, posting to the entry's delete route", () => {
    const html = scheduleControlCells("aide", entry());
    expect(html.indexOf("Run now")).toBeLessThan(html.indexOf(">Delete<"));
    expect(html).toContain('<button type="button" class="btn danger" data-delete-schedule aria-label="Delete nightly-report">Delete</button>');
    const box = html.match(/<dialog class="confirmdialog">[\s\S]*?<\/dialog>/)![0];
    expect(box).toContain("Delete aide:nightly-report?");
    expect(box).toContain('action="/api/queue/schedule/aide/nightly-report/delete"');
    expect(box).toMatch(/<div class="dialogactions"><form method="post"[^>]*class="scheduledeleteform">/);
    expect(box).toMatch(/btn danger[^>]*>[\s\S]*?OK[\s\S]*?<\/form><form method="dialog"><button class="btn" type="submit">Cancel<\/button><\/form><\/div>/);
  });
});

describe("a project's Schedule tab", () => {
  const view: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
  const page = (error?: string) =>
    renderProjectPage(view, { hasConfigFile: false, rows: [] }, null, "2026-09-26T00:00:00Z", [], {
      worktreeLinkCandidates: [],
      editing: false,
      tab: "schedule",
      ...(error ? { error } : {}),
      schedule: [entry()],
      scheduleLastRuns: { "nightly-report": { lastState: "done", outputHref: "/schedule/aide/nightly-report#report" } },
    });

  test("each entry's row opens its own page, and carries its controls, its last run and a slot for a refused Run now", () => {
    const html = page();
    // The whole row opens the entry's own page, as its name does.
    const row = html.match(/<tr data-row-href="\/schedule\/aide\/nightly-report"><td><a href="\/schedule\/aide\/nightly-report">[\s\S]*?<\/tr>/)![0];
    expect(row).toContain("scheduleenabled");
    expect(row).toContain("schedulerun");
    expect(row).toContain("data-delete-schedule");
    expect(row).toContain("<span data-schedule-state>Done</span>");
    expect(row).toContain('href="/schedule/aide/nightly-report#report"');
    expect(html).toContain('<p class="refused" aria-live="polite"></p>');
  });

  test("New, above the table, opens the page that makes an entry in this project", () => {
    const html = page();
    const top = html.match(/<div class="listtop">([\s\S]*?)<\/div>/)![1]!;
    expect(top).toContain('href="/schedule/new?project=aide"');
    expect(html.indexOf('class="listtop"')).toBeLessThan(html.indexOf("<table"));
    expect(html).not.toContain('class="scheduleform"');
  });

  test("a refusal a press with no script was sent back with is shown in the slot above the table", () => {
    expect(page("nope: the entry is gone")).toContain(
      '<p class="refused rowmsg failed" aria-live="polite">nope: the entry is gone</p>',
    );
  });
});
