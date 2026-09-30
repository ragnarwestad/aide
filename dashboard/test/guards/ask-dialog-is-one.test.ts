// Every confirmation on the board asks in the same dialog, drawn by one
// function and opened by one piece of script. A second copy of either — a
// dialog written out by hand beside the shared one, or an opener bound per
// button — is how they drift apart, so the sources are scanned for one of
// each. Comment lines are left out: a comment that names a hook draws nothing.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const DIALOG = "src/render/ui/components/confirm-dialog.ts";

const code = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");

const read = (glob: string): { file: string; text: string }[] =>
  [...new Bun.Glob(glob).scanSync(ROOT)].map((file) => ({ file, text: code(readFileSync(join(ROOT, file), "utf8")) }));

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

  test("only the shared function writes the dialog, its answers row and the standing mark (AC-1)", () => {
    const all = [...render, ...client, ...serve];
    // The page script reads the standing mark; only markup writes it.
    expect(writing([...render, ...serve], "data-progress-dialog")).toEqual([DIALOG]);
    expect(writing(all, "dialogactions")).toEqual([DIALOG]);
    expect(writing(all, "dialogAnswers(")).toEqual([DIALOG]);
    // Deploy's dialog borrows the look, but asks nothing and has no answers row.
    expect(writing(all, `class="confirmdialog`)).toEqual([
      "src/render/pages/projects-page/deploy-dialog.ts",
      DIALOG,
    ]);
  });

  test("one script file opens every dialog from its button, and no per-kind hook is left (AC-2)", () => {
    expect(writing(client, "data-ask")).toEqual(["src/specs-client/ask.ts"]);
    expect(writing(client, "showModal")).toEqual([
      "src/specs-client/ask.ts",
      "src/specs-client/deploy/index.ts",
      "src/specs-client/progress-dialog/index.ts",
    ]);
    const all = [...render, ...client, ...serve];
    expect(writing(all, "data-close-ask")).toEqual([]);
    expect(writing(all, "delete-schedule")).toEqual([]);
    expect(writing(all, "cancelform")).toEqual([]);
  });

  test("only the New-spec form wears the New-spec form's class (AC-5)", () => {
    expect(writing(render, "newspecform")).toEqual(["src/render/pages/new-spec-page.ts"]);
  });
});
