// A schedule entry's controls — the Enabled switch, Run now and Delete —
// drawn on the entry's row of its project's own Schedule tab.
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
  const page = () =>
    renderProjectPage(view, { hasConfigFile: false, rows: [] }, null, "2026-09-26T00:00:00Z", [], {
      worktreeLinkCandidates: [],
      editing: false,
      tab: "schedule",
      schedule: [entry()],
      scheduleLastRuns: { "nightly-report": { lastState: "done", outputHref: "/schedule/aide/nightly-report#report" } },
    });

  test("each entry's row carries its controls, its last run and a slot for a refused Run now", () => {
    const html = page();
    const row = html.match(/<tr><td><a href="\/schedule\/aide\/nightly-report">[\s\S]*?<\/tr>/)![0];
    expect(row).toContain("scheduleenabled");
    expect(row).toContain("schedulerun");
    expect(row).toContain("data-delete-schedule");
    expect(row).toContain("<span data-schedule-state>Done</span>");
    expect(row).toContain('href="/schedule/aide/nightly-report#report"');
    expect(html).toContain('<p class="refused" aria-live="polite"></p>');
  });
});
