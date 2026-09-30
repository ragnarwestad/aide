// Every step the board shows running is shown in a dialog drawn by
// `progressDialog()`: Close, Reopen, Remove project and Deploy. Each is
// marked for the page script that holds it open, and says what it is doing
// in its one heading. Marks and words the script and the reader depend on,
// not layout.
import { describe, expect, test } from "bun:test";
import { renderProjectPage, renderSpecsRows, type ProjectPageOptions, type ProjectView } from "../../../src/render";
import { closeAskDialog } from "../../../src/render/pages/spec-page/ask-dialog.ts";
import { reopenControl } from "../../../src/render/pages/spec-page/overview.ts";
import { view } from "../pages/spec-page-fixtures.ts";

/** The first dialog whose opening tag carries `mark`, whole, or "". */
const dialogWith = (html: string, mark: string): string =>
  html.match(new RegExp(`<dialog[^>]*${mark}[^>]*>[\\s\\S]*?</dialog>`))?.[0] ?? "";

const standingTitle = (box: string): string => box.match(/<h2 class="standingtitle">([^<]*)<\/h2>/)?.[1] ?? "";

const expectProgress = (box: string, word: string): void => {
  expect(box).not.toBe("");
  expect(box).toMatch(/^<dialog class="progressdialog"/);
  expect(box).toContain("data-progress-dialog");
  expect(standingTitle(box)).toBe(word);
};

const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const projectPage = (opts: Partial<ProjectPageOptions>): string =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    ...opts,
  });

describe("every running step is drawn by the progress dialog", () => {
  test("Close's dialog stands as Closing… (AC-1)", () => {
    expectProgress(dialogWith(closeAskDialog("aide", "150-x", "en"), `id="closeask"`), "Closing…");
  });

  test("Reopen's dialog on the spec page stands as Reopening… (AC-1)", () => {
    const html = reopenControl(view({ archived: true }));
    expectProgress(dialogWith(html, `id="reopenask"`), "Reopening…");
  });

  test("Reopen's dialog on an archived row of the list stands as Reopening… (AC-1)", () => {
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
    expectProgress(box, "Reopening…");
  });

  test("Remove project's dialog stands as Removing… (AC-1)", () => {
    const html = projectPage({ tab: "config", removable: true });
    expectProgress(dialogWith(html, `id="removeask"`), "Removing…");
  });

  test("Deploy's dialog stands as Deploying… and holds its five steps (AC-1)", () => {
    const html = projectPage({ tab: "deploy", drift: { behind: 2, checkedAt: Date.parse("2026-09-20T00:00:00Z") } });
    const box = dialogWith(html, "data-deploy-dialog");
    expectProgress(box, "Deploying…");
    expect([...box.matchAll(/<li data-step="/g)].length).toBe(5);
  });

  test("Deploy's dialog, which asks nothing, carries none of the confirmation's classes (AC-5)", () => {
    const html = projectPage({ tab: "deploy", drift: { behind: 2, checkedAt: Date.parse("2026-09-20T00:00:00Z") } });
    const box = dialogWith(html, "data-deploy-dialog");
    expect(box).not.toBe("");
    expect(box).not.toContain("confirmdialog");
    expect(box).not.toContain("confirmpanel");
    expect(box).not.toContain("dialogactions");
  });
});
