// Every confirmation on the board asks in the same question and answers,
// drawn by one function; every step it shows running is shown in one
// progress dialog, drawn by another; one piece of script opens any of them
// from its button, and one holds a running one open. A second copy of any
// — a dialog written out by hand beside the shared one, an opener bound per
// button, a hold written again for one dialog — is how they drift apart, so
// the sources are scanned for one of each. Comment lines are left out: a
// comment that names a hook draws nothing.
import { describe, expect, test } from "bun:test";
import { read } from "./source.ts";

const DIALOG = "src/render/ui/components/confirm-dialog.ts";
const PROGRESS = "src/render/ui/components/progress-dialog.ts";
const HOLD = "src/specs-client/progress-dialog/index.ts";

const writing = (files: { file: string; text: string }[], needle: string): string[] =>
  files.filter((f) => f.text.includes(needle)).map((f) => f.file).sort();

describe("one ask dialog, one opener", () => {
  const render = read("src/render/**/*.ts");
  const client = read("src/specs-client/**/*.ts");
  const serve = read("src/serve/**/*.ts");

  test("the globs found the sources at all", () => {
    // A guard that silently matches nothing passes forever.
    expect(render.length).toBeGreaterThan(15);
    expect(client.length).toBeGreaterThan(15);
  });

  test("only the confirmation writes its dialog class and its answers row (AC-5)", () => {
    const all = [...render, ...client, ...serve];
    expect(writing(all, "dialogactions")).toEqual([DIALOG]);
    expect(writing(all, "dialogAnswers(")).toEqual([DIALOG]);
    expect(writing(all, `class="confirmdialog`)).toEqual([DIALOG]);
  });

  test("only the progress dialog writes its class, its standing mark and its running word (AC-1)", () => {
    // The page script reads the standing mark; only markup writes it.
    expect(writing([...render, ...serve], "data-progress-dialog")).toEqual([PROGRESS]);
    expect(writing([...render, ...serve], `class="progressdialog`)).toEqual([PROGRESS]);
    expect(writing([...render, ...serve], "standingtitle")).toEqual([PROGRESS]);
  });

  test("one script file opens every dialog from its button, and one holds a running one (AC-2)", () => {
    expect(writing(client, "data-ask")).toEqual(["src/specs-client/ask.ts"]);
    expect(writing(client, "showModal")).toEqual(["src/specs-client/ask.ts", HOLD]);
    expect(writing(client, `"cancel"`)).toEqual([HOLD]);
  });

  test("only the New-spec form wears the New-spec form's class (AC-5)", () => {
    expect(writing(render, "newspecform")).toEqual(["src/render/pages/new-spec-page/index.ts"]);
  });
});
