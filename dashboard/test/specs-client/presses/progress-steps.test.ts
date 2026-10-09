// The step list a Close or Reopen dialog draws while its job runs
// (`drawSteps`), on the server's own markup in happy-dom.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { stepPlan } from "../../../src/queue/parse-stream";
import { closeAskDialog } from "../../../src/render/pages/spec-page/ask-dialog.ts";
import { progressDialog } from "../../../src/render/ui/components";
import { drawSteps, resetSteps } from "../../../src/specs-client/progress-dialog";

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

/** A dialog whose step list could not be read: no planned lines, only the template. */
const emptyList = () => progressDialog("en", { id: "closeask", title: "closing", steps: [] });

describe("drawSteps", () => {
  test("each mark gets a line from the dialog's own template, carrying its key, in the order given, when the list is empty (AC-4)", () => {
    const { dialog, lines } = dialogOf(emptyList());
    drawSteps(dialog, [
      { ...PREPARING, state: "done" },
      { ...SCRIPT, state: "running" },
    ]);
    expect(lines().map(({ key, state, text }) => ({ key, state, text }))).toEqual([
      { key: PREPARING.key, state: "done", text: "Preparing done" },
      { key: SCRIPT.key, state: "running", text: "Run the mechanical script running" },
    ]);
  });

  test("marks change the planned lines in place: the same nodes, the other lines waiting, the count unchanged (AC-3)", () => {
    const { dialog, lines } = dialogOf(closeAskDialog("aide", "591-x", "en"));
    const plan = stepPlan("close");
    const before = lines();
    expect(before.length).toBe(plan.length);
    drawSteps(dialog, [
      { key: plan[0]!.key, title: plan[0]!.label, state: "done" },
      { key: plan[1]!.key, title: plan[1]!.label, state: "running" },
    ]);
    const after = lines();
    expect(after.map((l) => l.key)).toEqual(plan.map((s) => s.key));
    expect(after.every((l, i) => l.node === before[i]!.node)).toBe(true);
    expect(after.map((l) => l.state)).toEqual(["done", "running", ...plan.slice(2).map(() => "waiting")]);
  });

  test("a dialog with no list, or an answer with no marks, draws nothing and throws nothing (AC-4)", () => {
    const bare = dialogOf(`<dialog data-progress-dialog><div data-running-face></div></dialog>`);
    expect(() => drawSteps(bare.dialog, [{ ...PREPARING, state: "done" }])).not.toThrow();
    expect(bare.lines()).toEqual([]);
    const close = dialogOf(emptyList());
    expect(() => drawSteps(close.dialog, undefined)).not.toThrow();
    expect(() => drawSteps(null, [{ ...PREPARING, state: "done" }])).not.toThrow();
    expect(close.lines()).toEqual([]);
  });

  test("a step marked started is drawn running, the state its spinner is drawn from (AC-2)", () => {
    const { dialog, lines } = dialogOf(emptyList());
    drawSteps(dialog, [{ ...PREPARING, state: "running" }]);
    expect(lines()[0]!.state).toBe("running");
  });

  test("a later poll that marks the running step done moves the same line, and adds none (AC-3)", () => {
    const { dialog, lines } = dialogOf(emptyList());
    drawSteps(dialog, [{ ...PREPARING, state: "running" }]);
    const first = lines()[0]!.node;
    drawSteps(dialog, [{ ...PREPARING, state: "done" }]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]!.node).toBe(first);
    expect(lines()[0]!.state).toBe("done");
  });
});

describe("resetSteps", () => {
  test("puts every planned line back to waiting and drops the lines an earlier job's log added (AC-3)", () => {
    const { dialog, lines } = dialogOf(closeAskDialog("aide", "591-x", "en"));
    const plan = stepPlan("close");
    const planned = lines().map((l) => l.node);
    drawSteps(dialog, [
      { key: plan[0]!.key, title: plan[0]!.label, state: "done" },
      { ...SCRIPT, key: "Step 9 of 9", state: "running" },
    ]);
    expect(lines()).toHaveLength(plan.length + 1);
    resetSteps(dialog);
    expect(lines().length === planned.length && lines().every((l, i) => l.node === planned[i])).toBe(true);
    expect(lines().map((l) => l.state)).toEqual(plan.map(() => "waiting"));
    expect(lines()[0]!.text).toEndWith(dialog.querySelector("ol")!.getAttribute("data-waiting")!);
  });

  test("a dialog with no list does nothing (AC-3)", () => {
    const bare = dialogOf(`<dialog data-progress-dialog><div data-running-face></div></dialog>`);
    expect(() => resetSteps(bare.dialog)).not.toThrow();
  });
});
