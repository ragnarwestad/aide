// The Depends on picker on the Running tab's open rows: a tick outlives a
// live redraw of the rows and sits in the picked block, Cancel puts the
// ticks back as the server drew them and forgets them, and two rows keep
// their pickers apart.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { SpecTarget } from "../../../src/render";
import { groupBySpec } from "../../../src/render/pages/specs-list/data-model";
import { dependsOnFormId, dependsOnLine } from "../../../src/render/pages/specs-list/depends-on";
import { cancelDependsOn, pickDependency } from "../../../src/specs-client/depends-on";
import { chosenSteps } from "../../../src/specs-client/state.ts";
import { restoreChosen } from "../../../src/specs-client/row-swap.ts";

const A = "81-first-spec";
const B = "82-second-spec";
const THIRD = "99-a-third-spec";
const targets: SpecTarget[] = [A, B, THIRD].map((specFolder) => ({ project: "aide", specFolder }));
const groups = groupBySpec([], targets);
const lineOf = (folder: string): string =>
  dependsOnLine(groups.find((g) => g.specFolder === folder)!, { targets });
const formId = (folder: string): string => dependsOnFormId(groups.find((g) => g.specFolder === folder)!);
const ROWS = `<table><tbody>${lineOf(A)}${lineOf(B)}</tbody></table>`;

const windows: Window[] = [];
const savedEvent = globalThis.Event;
beforeEach(() => chosenSteps.clear());
afterEach(async () => {
  globalThis.Event = savedEvent;
  while (windows.length) await windows.pop()!.happyDOM.close();
});

/** Two open rows, with the page's own chip mover loaded as the page loads it. */
function list(): { rows: HTMLElement; redraw: () => void } {
  const win = new Window();
  windows.push(win);
  globalThis.Event = win.Event as unknown as typeof Event;
  win.document.write(`<div id="jobrows">${ROWS}</div>`);
  const lift = new Bun.Transpiler({ loader: "ts" }).transformSync(
    readFileSync(new URL("../../../src/render/ui/forms/depends-lift.ts", import.meta.url), "utf-8"),
  );
  win.eval(lift);
  const rows = win.document.getElementById("jobrows") as unknown as HTMLElement;
  return {
    rows,
    redraw: () => {
      rows.innerHTML = ROWS;
      restoreChosen(rows);
    },
  };
}

const form = (rows: HTMLElement, folder: string) => rows.querySelector(`#${formId(folder)}`) as HTMLFormElement;
const box = (rows: HTMLElement, folder: string, dependency: string) =>
  form(rows, folder).querySelector(`input[name="dependsOn"][value="${dependency}"]`) as HTMLInputElement;
const cancel = (rows: HTMLElement, folder: string) => rows.querySelector(`#${formId(folder)}-cancel`) as HTMLButtonElement;
const pickedBlock = (rows: HTMLElement, folder: string) => form(rows, folder).querySelector(".phases.picked") as HTMLElement;

/** Tick a box the way a hand does: the change reaches the chip mover, then the page's own handler. */
function tick(rows: HTMLElement, folder: string, dependency: string, on = true): void {
  const b = box(rows, folder, dependency);
  b.checked = on;
  b.dispatchEvent(new Event("change", { bubbles: true }));
  pickDependency(b);
}

describe("the Depends on picker's ticks", () => {
  test("a tick outlives a redraw, sits in the picked block, and keeps Cancel offered (AC-3)", () => {
    const { rows, redraw } = list();
    tick(rows, A, THIRD);
    expect(cancel(rows, A).disabled).toBe(false);
    redraw();
    expect(box(rows, A, THIRD).checked).toBe(true);
    expect(pickedBlock(rows, A).contains(box(rows, A, THIRD))).toBe(true);
    expect(cancel(rows, A).disabled).toBe(false);
  });

  test("Cancel puts the drawn ticks back, is disabled again, and the next redraw does not bring the tick back (AC-3)", () => {
    const { rows, redraw } = list();
    tick(rows, A, THIRD);
    redraw();
    cancelDependsOn(cancel(rows, A));
    expect(box(rows, A, THIRD).checked).toBe(false);
    expect(pickedBlock(rows, A).contains(box(rows, A, THIRD))).toBe(false);
    expect(cancel(rows, A).disabled).toBe(true);
    redraw();
    expect(box(rows, A, THIRD).checked).toBe(false);
    expect(cancel(rows, A).disabled).toBe(true);
  });

  test("two rows' pickers keep apart: a tick, a redraw and a Cancel in one leave the other alone (AC-3)", () => {
    const { rows, redraw } = list();
    tick(rows, A, THIRD);
    tick(rows, B, THIRD);
    redraw();
    cancelDependsOn(cancel(rows, A));
    expect(box(rows, A, THIRD).checked).toBe(false);
    expect(box(rows, B, THIRD).checked).toBe(true);
    expect(cancel(rows, B).disabled).toBe(false);
    redraw();
    expect(box(rows, A, THIRD).checked).toBe(false);
    expect(box(rows, B, THIRD).checked).toBe(true);
  });
});
