// Every step the board shows running is shown in a dialog drawn by
// `progressDialog()`: Close, Reopen, Remove project and Deploy. Each is
// marked for the page script that holds it open, and has a heading for its
// running face. Marks the script depends on, not layout or wording.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderProjectPage, renderSpecsRows, type ProjectPageOptions, type ProjectView } from "../../../src/render";
import { stepPlan } from "../../../src/queue/parse-stream";
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

describe("the step list a dialog's script finds in its running face", () => {
  /** The list in the box's running face, and its line template, parsed. */
  const stepsOf = (box: string) => {
    const window = new Window();
    window.document.body.innerHTML = box;
    const face = window.document.querySelector("[data-running-face]");
    return {
      list: face?.querySelector("ol.progresssteps") ?? null,
      template: face?.querySelector("template[data-step-line]") ?? null,
      steps: [...(face?.querySelectorAll("ol.progresssteps > li[data-step]") ?? [])].map((li) => li.getAttribute("data-step")),
    };
  };

  /** Each line of the box's step list: its key, its state, its label and the waiting word it shows. */
  const linesOf = (box: string) => {
    const window = new Window();
    window.document.body.innerHTML = box;
    const face = window.document.querySelector("[data-running-face]")!;
    const word = face.querySelector("ol.progresssteps")?.getAttribute("data-waiting");
    return [...face.querySelectorAll("ol.progresssteps > li[data-step]")].map((li) => ({
      key: li.getAttribute("data-step"),
      state: li.getAttribute("data-state"),
      text: li.textContent?.replace(/\s+/g, " ").trim(),
      word,
    }));
  };

  test("Close's and Reopen's dialogs carry one line per step of their plan, in order, and the line template (AC-1)", () => {
    const boxes = {
      close: dialogWith(closeAskDialog("aide", "150-x", "en"), `id="closeask"`),
      reopen: dialogWith(reopenControl(view({ archived: true })), `id="reopenask"`),
    };
    for (const [step, box] of Object.entries(boxes)) {
      const plan = stepPlan(step);
      expect(plan).not.toEqual([]);
      const got = stepsOf(box);
      expect(got.list).not.toBeNull();
      expect(got.template).not.toBeNull();
      expect(got.steps).toEqual(plan.map((s) => s.key));
      expect(linesOf(box).map((l) => l.text)).toEqual(plan.map((s) => `${s.label} ${linesOf(box)[0]!.word}`));
    }
  });

  test("every planned line is waiting, with the list's waiting word, when the dialog opens (AC-2)", () => {
    for (const box of [
      dialogWith(closeAskDialog("aide", "150-x", "en"), `id="closeask"`),
      dialogWith(reopenControl(view({ archived: true })), `id="reopenask"`),
    ]) {
      const lines = linesOf(box);
      expect(lines).not.toEqual([]);
      for (const line of lines) {
        expect(line.state).toBe("waiting");
        expect(line.word).toBeTruthy();
        expect(line.text?.endsWith(line.word!)).toBe(true);
      }
    }
  });

  test("Deploy's five steps are lines of the same list, in its running face (AC-5)", () => {
    const html = projectPage({ tab: "deploy", drift: { behind: 2, checkedAt: Date.parse("2026-09-20T00:00:00Z") } });
    expect(stepsOf(dialogWith(html, "data-deploy-dialog")).steps).toEqual(["fetch", "install", "restart", "wait", "check"]);
  });
});
