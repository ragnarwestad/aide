// The files under a criterion the reader has open: they are read before the
// list is redrawn and opened again after, and a file the reader shut or the
// redraw no longer draws opens nothing.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { acTestsLine } from "../../../src/render/ui/ac-tests.ts";
import { openTestFiles, reopenTestFiles } from "../../../src/specs-client/test-files";

const SCOPE = "aide/624-x";
const ROW = {
  task: "AC-1: it counts",
  tests: [
    { file: "a.test.ts", name: "first (AC-1)" },
    { file: "b.test.ts", name: "second (AC-1)" },
  ],
};

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function list(html: string): HTMLElement {
  const win = new Window();
  windows.push(win);
  win.document.write(`<div id="jobrows">${html}</div>`);
  return win.document.getElementById("jobrows") as unknown as HTMLElement;
}

const folds = (rows: HTMLElement) => [...rows.querySelectorAll("details")] as HTMLDetailsElement[];

describe("the open criterion test fold", () => {
  test("an opened criterion is open again after the list's markup is replaced (AC-8)", () => {
    const rows = list(acTestsLine(ROW, "en", SCOPE));
    folds(rows)[0]!.open = true;
    const open = openTestFiles(rows);
    rows.innerHTML = acTestsLine(ROW, "en", SCOPE);
    expect(folds(rows).map((d) => d.open)).toEqual([false]);
    reopenTestFiles(rows, open);
    expect(folds(rows).map((d) => d.open)).toEqual([true]);
  });

  test("Unit and Browser folds keep their own open state after a redraw", () => {
    const row = { task: "AC-1: x", tests: [
      { file: "unit.ts", name: "unit", kind: "unit" as const },
      { file: "browser.ts", name: "browser", kind: "browser" as const },
    ] };
    const rows = list(acTestsLine(row, "en", SCOPE));
    const browser = rows.querySelector(`[data-testcriterion="${SCOPE}|1|browser"]`) as HTMLDetailsElement;
    browser.open = true;
    const open = openTestFiles(rows);
    rows.innerHTML = acTestsLine(row, "en", SCOPE);
    reopenTestFiles(rows, open);
    expect((rows.querySelector(`[data-testcriterion="${SCOPE}|1|unit"]`) as HTMLDetailsElement).open).toBe(false);
    expect((rows.querySelector(`[data-testcriterion="${SCOPE}|1|browser"]`) as HTMLDetailsElement).open).toBe(true);
  });

  test("a key whose file is no longer drawn opens nothing", () => {
    const rows = list(acTestsLine(ROW, "en", SCOPE));
    folds(rows)[0]!.open = true;
    const open = openTestFiles(rows);
    rows.innerHTML = acTestsLine({ task: "AC-2: changed", tests: [ROW.tests[0]!] }, "en", SCOPE);
    reopenTestFiles(rows, open);
    expect(folds(rows).map((d) => d.open)).toEqual([false]);
  });
});
