// Every step the board shows running is shown in a dialog drawn by
// `progressDialog()`: Close, Reopen, Remove project and Deploy. Each is
// marked for the page script that holds it open, and has a heading for its
// running face. Marks the script depends on, not layout or wording.
import { describe, expect, test } from "bun:test";
import { renderProjectPage, renderSpecsRows, type ProjectPageOptions, type ProjectView } from "../../../src/render";
import { closeAskDialog } from "../../../src/render/pages/spec-page/ask-dialog.ts";
import { reopenControl } from "../../../src/render/pages/spec-page/overview.ts";
import { view } from "../pages/spec-page-fixtures.ts";

/** The first dialog whose opening tag carries `mark`, whole, or "". */
const dialogWith = (html: string, mark: string): string =>
  html.match(new RegExp(`<dialog[^>]*${mark}[^>]*>[\\s\\S]*?</dialog>`))?.[0] ?? "";

/** The heading of the dialog's running face: what it says while it stands. */
const runningWord = (box: string): string => box.match(/data-running-face[^>]*><h2[^>]*>([^<]*)<\/h2>/)?.[1] ?? "";

const expectProgress = (box: string): void => {
  expect(box).not.toBe("");
  expect(box).toContain("data-progress-dialog");
  expect(runningWord(box)).not.toBe("");
};

const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const projectPage = (opts: Partial<ProjectPageOptions>): string =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    ...opts,
  });

describe("every running step is drawn by the progress dialog", () => {
  test("Close's dialog is a progress dialog (AC-1)", () => {
    expectProgress(dialogWith(closeAskDialog("aide", "150-x", "en"), `id="closeask"`));
  });

  test("Reopen's dialog on the spec page is a progress dialog (AC-1)", () => {
    const html = reopenControl(view({ archived: true }));
    expectProgress(dialogWith(html, `id="reopenask"`));
  });

  test("Reopen's dialog on an archived row of the list is a progress dialog (AC-1)", () => {
    const html = renderSpecsRows([], {
      runnerAvailable: true,
      targets: [],
      archivedSpecs: [
        {
          project: "aide",
          folder: "50-archived",
          title: "Title of 50-archived",
          description: "What it was about.",
          createdAt: "2026-08-01T09:00:00Z",
          done: ["create", "analyze", "implement", "archive"],
          models: {},
          phaseOutcomes: {},
        },
      ],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    const box = dialogWith(html, `id="[^"]*reopen[^"]*"`);
    expectProgress(box);
  });

  test("Remove project's dialog is a progress dialog (AC-1)", () => {
    const html = projectPage({ tab: "config", removable: true });
    expectProgress(dialogWith(html, `id="removeask"`));
  });

  test("Deploy's dialog is a progress dialog that asks nothing, so it stands from the moment it opens (AC-1, AC-5)", () => {
    const html = projectPage({ tab: "deploy", drift: { behind: 2, checkedAt: Date.parse("2026-09-20T00:00:00Z") } });
    const box = dialogWith(html, "data-deploy-dialog");
    expectProgress(box);
    expect(box).not.toContain("data-asks");
    expect(box).not.toContain(`method="dialog"`);
  });
});
