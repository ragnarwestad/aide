// The approach warning's radios on the Specs list: a pick outlives a live
// redraw of the rows, and Cancel puts the recommended approach back and
// forgets the pick, so the next redraw does not bring it back.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { SpecTarget } from "../../../src/render";
import { groupBySpec } from "../../../src/render/pages/specs-list/data-model";
import { approachPanel } from "../../../src/render/pages/specs-list/approach-choice";
import { cancelApproach, pickApproach } from "../../../src/specs-client/approach-choice";
import { restoreChosen } from "../../../src/specs-client/row-swap.ts";

const FOLDER = "590-choose-the-approach";
const FORM = `approach-aide-${FOLDER}`;
const target: SpecTarget = {
  project: "aide",
  specFolder: FOLDER,
  done: ["create", "analyze"],
  approachChoice: [
    { letter: "A", title: "Hold it", mark: "recommended" },
    { letter: "B", title: "End it", mark: "real alternative" },
  ],
};
const PANEL = approachPanel(groupBySpec([], [target])[0]!, "en");

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function list(): { rows: HTMLElement; redraw: () => void } {
  const win = new Window();
  windows.push(win);
  win.document.write(`<div id="jobrows">${PANEL}</div>`);
  const rows = win.document.getElementById("jobrows") as unknown as HTMLElement;
  return {
    rows,
    redraw: () => {
      rows.innerHTML = PANEL;
      restoreChosen(rows);
    },
  };
}

const radio = (rows: HTMLElement, letter: string) =>
  rows.querySelector(`input[name="approach"][value="${letter}"]`) as HTMLInputElement;
const cancel = (rows: HTMLElement) => rows.querySelector(`#${FORM}-cancel`) as HTMLButtonElement;

describe("the approach radios", () => {
  test("a pick outlives a redraw, with Cancel still offered (AC-3)", () => {
    const { rows, redraw } = list();
    radio(rows, "B").checked = true;
    pickApproach(radio(rows, "B"));
    expect(cancel(rows).disabled).toBe(false);
    redraw();
    expect(radio(rows, "B").checked).toBe(true);
    expect(radio(rows, "A").checked).toBe(false);
    expect(cancel(rows).disabled).toBe(false);
  });

  test("Cancel after a redraw picks the recommended one again, and the next redraw keeps it (AC-3)", () => {
    const { rows, redraw } = list();
    radio(rows, "B").checked = true;
    pickApproach(radio(rows, "B"));
    redraw();
    cancelApproach(cancel(rows));
    expect(radio(rows, "A").checked).toBe(true);
    expect(radio(rows, "B").checked).toBe(false);
    expect(cancel(rows).disabled).toBe(true);
    redraw();
    expect(radio(rows, "A").checked).toBe(true);
    expect(cancel(rows).disabled).toBe(true);
  });
});
