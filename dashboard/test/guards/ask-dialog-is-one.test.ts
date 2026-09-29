// Close and Reopen ask in the same dialog, drawn by one function and opened
// by one piece of script. A second copy of either — a dialog written out by
// hand beside the shared one, or an opener bound per button — is how the two
// drift apart, so the source is scanned for one of each.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const read = (glob: string): { file: string; text: string }[] =>
  [...new Bun.Glob(glob).scanSync(ROOT)].map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));

const writing = (files: { file: string; text: string }[], needle: string): string[] =>
  files.filter((f) => f.text.includes(needle)).map((f) => f.file);

describe("one ask dialog, one opener", () => {
  const render = read("src/render/**/*.ts");
  const client = read("src/specs-client/**/*.ts");

  test("the globs found the sources at all", () => {
    // A guard that silently matches nothing passes forever.
    expect(render.length).toBeGreaterThan(15);
    expect(client.length).toBeGreaterThan(15);
  });

  test("one render file writes the dialog, one script file opens it, and no Close-only hook is left (AC-5)", () => {
    expect(writing(render, "data-progress-dialog")).toEqual(["src/render/pages/spec-page/ask-dialog.ts"]);
    expect(writing(client, "data-ask")).toEqual(["src/specs-client/progress-dialog/index.ts"]);
    expect(writing([...render, ...client, ...read("src/serve/**/*.ts")], "data-close-ask")).toEqual([]);
  });
});
