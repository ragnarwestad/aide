// Every confirmation on the board is drawn by `confirmDialog()`: each
// caller's dialog carries the id its button names and the affirmative's
// form `<id>-form`, and only Close and Reopen stand while their job runs.
// Ids and attributes the page script depends on, not layout.
import { describe, expect, test } from "bun:test";
import { renderProjectPage, renderSpecsRows, type ProjectView } from "../../../src/render";
import { closeAskDialog, reopenAskDialog } from "../../../src/render/pages/spec-page/ask-dialog.ts";
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
  test("Cancel on a running list row names its dialog, which does not stand (AC-1)", () => {
    const r = row({ id: "j1", specFolder: "105-busy", steps: ["implement"], stepIndex: 0, state: "running" });
    const targets = [{ project: "aide", specFolder: "105-busy" }];
    const html = renderSpecsRows(
      [r],
      { runnerAvailable: true, targets, filter: { open: openKeys([r], targets) }, modelChoices: [{ name: "sonnet" }] },
      Date.parse("2026-08-19T12:00:00Z"),
    );
    const box = expectAsk(html, "cancelask-j1");
    expect(html).toContain(`data-ask="cancelask-j1"`);
    expect(box).toContain(`action="/api/queue/j1/cancel"`);
    expect(box).not.toContain("data-progress-dialog");
  });

  test("Delete on a schedule row names its dialog (AC-1)", () => {
    const html = scheduleControlCells("aide", { name: "nightly", cron: "0 3 * * *", prompt: "x", enabled: true });
    const box = expectAsk(html, "deleteask-aide/nightly");
    expect(html).toContain(`data-ask="deleteask-aide/nightly"`);
    expect(box).toContain(`action="/api/queue/schedule/aide/nightly/delete"`);
    expect(box).not.toContain("data-progress-dialog");
  });

  test("the question before leaving a page answers with its value and posts nothing (AC-1)", () => {
    const html = pageShell("Projects", [{ label: "Projects", path: "/projects" }], "/projects", "<p>x</p>", "2026-09-01T00:00:00Z");
    const box = expectAsk(html, "leaveapp");
    expect(box).toContain(`value="leave"`);
    expect(box).not.toContain(`method="post"`);
  });

  test("Remove project on an allowlisted project's Config tab names its dialog (AC-1)", () => {
    const view: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
    const html = renderProjectPage(view, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", [], {
      worktreeLinkCandidates: [],
      editingGroup: null,
      tab: "config",
      removable: true,
    });
    const box = expectAsk(html, "removeask");
    expect(html).toContain(`data-ask="removeask"`);
    expect(box).toContain(`action="/api/queue/projects/aide/remove"`);
    expect(box).toContain(`class="removeform"`);
  });

  test("Close and Reopen name theirs, and stand while their job runs (AC-1)", () => {
    const close = expectAsk(closeAskDialog("aide", "150-x", "en"), "closeask");
    const reopen = expectAsk(reopenAskDialog("aide", "150-x", "en", { id: "reopenask", back: "/specs/aide/150-x" }), "reopenask");
    expect(close).toContain("data-progress-dialog");
    expect(reopen).toContain("data-progress-dialog");
  });
});
