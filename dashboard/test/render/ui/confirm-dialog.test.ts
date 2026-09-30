// Every confirmation on the board asks in a dialog whose question and
// answers the confirmation component draws: each caller's dialog carries
// the id its button names and the affirmative's form `<id>-form`. Ids and
// attributes the page script depends on, not layout. Which button opens
// which dialog, and where OK posts, is proven in the browser
// (test/e2e/confirm-boxes-ok.test.ts) and by the opener (ask.test.ts).
import { describe, expect, test } from "bun:test";
import { renderProjectPage, renderSpecsRows, type ProjectView } from "../../../src/render";
import { scheduleControlCells } from "../../../src/render/pages/schedule-page/controls.ts";
import { pageShell } from "../../../src/render/ui/shell.ts";
import { openKeys, row } from "../pages/fixtures.ts";

/** The dialog with this id, whole, or "" when there is none. */
const dialog = (html: string, id: string): string =>
  html.match(new RegExp(`<dialog[^>]*\\sid="${id}"[^>]*>[\\s\\S]*?</dialog>`))?.[0] ?? "";

const expectAsk = (html: string, id: string): string => {
  const box = dialog(html, id);
  expect(box).not.toBe("");
  expect(box).toContain(`id="${id}-form"`);
  return box;
};

describe("each confirmation is drawn by the shared function", () => {
  test("the question before leaving a page answers with its value and posts nothing (AC-1, AC-5)", () => {
    const html = pageShell("Projects", [{ label: "Projects", path: "/projects" }], "/projects", "<p>x</p>", "2026-09-01T00:00:00Z");
    const box = expectAsk(html, "leaveapp");
    expect(box).toContain(`value="leave"`);
    expect(box).not.toContain(`method="post"`);
  });

  test("Cancel on a running row and Delete on a schedule row ask without standing (AC-5)", () => {
    const r = row({ id: "j1", specFolder: "105-busy", steps: ["implement"], stepIndex: 0, state: "running" });
    const targets = [{ project: "aide", specFolder: "105-busy" }];
    const list = renderSpecsRows(
      [r],
      { runnerAvailable: true, targets, filter: { open: openKeys([r], targets) }, modelChoices: [{ name: "sonnet" }] },
      Date.parse("2026-08-19T12:00:00Z"),
    );
    const schedule = scheduleControlCells("aide", { name: "nightly", cron: "0 3 * * *", prompt: "x", enabled: true });
    expect(expectAsk(list, "cancelask-j1")).not.toContain("data-progress-dialog");
    expect(expectAsk(schedule, "deleteask-aide/nightly")).not.toContain("data-progress-dialog");
  });

  test("Remove project's form carries the hook the page script binds its submit by (AC-1)", () => {
    const view: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
    const html = renderProjectPage(view, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", [], {
      worktreeLinkCandidates: [],
      editingGroup: null,
      tab: "config",
      removable: true,
    });
    expect(expectAsk(html, "removeask")).toMatch(/class="[^"]*\bremoveform\b/);
  });
});
