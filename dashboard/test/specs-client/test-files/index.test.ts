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

describe("the open files under a criterion", () => {
  test("an opened file is open again after the list's markup is replaced, and the other stays shut (AC-2)", () => {
    const rows = list(acTestsLine(ROW, "en", SCOPE));
    folds(rows)[0]!.open = true;
    const open = openTestFiles(rows);
    rows.innerHTML = acTestsLine(ROW, "en", SCOPE);
    expect(folds(rows).map((d) => d.open)).toEqual([false, false]);
    reopenTestFiles(rows, open);
    expect(folds(rows).map((d) => d.open)).toEqual([true, false]);
  });

  test("a key whose file is no longer drawn opens nothing (AC-2)", () => {
    const rows = list(acTestsLine(ROW, "en", SCOPE));
    folds(rows)[1]!.open = true;
    const open = openTestFiles(rows);
    rows.innerHTML = acTestsLine({ ...ROW, tests: [ROW.tests[0]!] }, "en", SCOPE);
    reopenTestFiles(rows, open);
    expect(folds(rows).map((d) => d.open)).toEqual([false]);
  });
});
