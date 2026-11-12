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
const FORM_DIALOG = "src/render/ui/components/form-dialog.ts";
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

  test("only the confirmation writes its dialog class and its answers row", () => {
    const all = [...render, ...client, ...serve];
    expect(writing(all, "dialogactions")).toEqual([DIALOG]);
    expect(writing(all, "dialogAnswers(")).toEqual([DIALOG]);
    expect(writing(all, `class="confirmdialog`)).toEqual([DIALOG]);
  });

  test("only the progress dialog writes its class, its mark and its cover word", () => {
    // The page script reads the mark and the word; only markup writes them.
    expect(writing([...render, ...serve], "data-progress-dialog")).toEqual([PROGRESS]);
    expect(writing([...render, ...serve], `class="progressdialog`)).toEqual([PROGRESS]);
    expect(writing([...render, ...serve], "data-cover-note")).toEqual([PROGRESS]);
  });

  test("a dialog that holds a form is written by the form dialog alone (AC-1)", () => {
    // The About box, the loading cover, the confirmation and the progress
    // dialog hold no form's fields; every other dialog is the component's.
    expect(writing(render, "<dialog")).toEqual(
      ["src/render/ui/busy/nav-overlay.ts", "src/render/ui/shell.ts", DIALOG, FORM_DIALOG, PROGRESS].sort(),
    );
    expect(writing([...render, ...client, ...serve], `class="formdialog`)).toEqual([FORM_DIALOG]);
  });

  test("one script file opens every dialog from its button, and one asks again after a refusal", () => {
    expect(writing(client, "data-ask")).toEqual(["src/specs-client/ask.ts"]);
    expect(writing(client, "showModal")).toEqual(["src/specs-client/ask.ts", HOLD]);
  });

  test("only the New-spec form wears the New-spec form's class", () => {
    expect(writing(render, "newspecform")).toEqual(["src/render/pages/new-spec-page/index.ts"]);
  });
});
