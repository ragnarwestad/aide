// The step list a Close or Reopen dialog draws while its job runs
// (`drawSteps`), on the server's own markup in happy-dom.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { closeAskDialog } from "../../../src/render/pages/spec-page/ask-dialog.ts";
import { reopenControl } from "../../../src/render/pages/spec-page/overview.ts";
import { drawSteps } from "../../../src/specs-client/progress-dialog";
import { view } from "../../render/pages/spec-page-fixtures.ts";

function dialogOf(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  const dialog = window.document.querySelector("dialog[data-progress-dialog]") as unknown as HTMLDialogElement;
  /** Each line in the step list: its key, its state and what it says. */
  const lines = () =>
    [...dialog.querySelectorAll("[data-running-face] li")].map((li) => ({
      key: (li as unknown as HTMLElement).dataset.step,
      state: (li as unknown as HTMLElement).dataset.state,
      text: li.textContent?.replace(/\s+/g, " ").trim(),
      node: li,
    }));
  return { window, dialog, lines };
}

const PREPARING = { key: "Step Aide: preparing", title: "Preparing" };
const SCRIPT = { key: "Step 1 of 4: Run the mechanical script", title: "Run the mechanical script" };

describe("drawSteps", () => {
  test("each mark gets a line from the dialog's own template, carrying its key, in the order given (AC-1)", () => {
    for (const html of [closeAskDialog("aide", "591-x", "en"), reopenControl(view({ archived: true }))]) {
      const { dialog, lines } = dialogOf(html);
      drawSteps(dialog, [
        { ...PREPARING, state: "done" },
        { ...SCRIPT, state: "running" },
      ]);
      expect(lines().map(({ key, state, text }) => ({ key, state, text }))).toEqual([
        { key: PREPARING.key, state: "done", text: "Preparing done" },
        { key: SCRIPT.key, state: "running", text: "Run the mechanical script running" },
      ]);
    }
  });

  test("a dialog with no list, or an answer with no marks, draws nothing and throws nothing (AC-1)", () => {
    const bare = dialogOf(`<dialog data-progress-dialog><div data-running-face></div></dialog>`);
    expect(() => drawSteps(bare.dialog, [{ ...PREPARING, state: "done" }])).not.toThrow();
    expect(bare.lines()).toEqual([]);
    const close = dialogOf(closeAskDialog("aide", "591-x", "en"));
    expect(() => drawSteps(close.dialog, undefined)).not.toThrow();
    expect(() => drawSteps(null, [{ ...PREPARING, state: "done" }])).not.toThrow();
    expect(close.lines()).toEqual([]);
  });

  test("a step marked started is drawn running, the state its spinner is drawn from (AC-2)", () => {
    const { dialog, lines } = dialogOf(closeAskDialog("aide", "591-x", "en"));
    drawSteps(dialog, [{ ...PREPARING, state: "running" }]);
    expect(lines()[0]!.state).toBe("running");
  });

  test("a later poll that marks the running step done moves the same line, and adds none (AC-3)", () => {
    const { dialog, lines } = dialogOf(closeAskDialog("aide", "591-x", "en"));
    drawSteps(dialog, [{ ...PREPARING, state: "running" }]);
    const first = lines()[0]!.node;
    drawSteps(dialog, [{ ...PREPARING, state: "done" }]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]!.node).toBe(first);
    expect(lines()[0]!.state).toBe("done");
  });
});
