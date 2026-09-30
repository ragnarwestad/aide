// A button, a link drawn as a button and a message line each have one
// component. A copy written out by hand beside it is how the two drift —
// one hand-written Run said "starting…" where every `btn()` said
// "Starting…" — so the sources are scanned for markup only the component
// may write.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const BUTTON = "src/render/ui/components/button.ts";
const MESSAGE = "src/render/ui/components/message.ts";

/** A source's code, with its comment lines left out: a comment that names
 *  `rowmsg` or `class="btn"` draws nothing. */
const code = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");

const read = (glob: string): { file: string; text: string }[] =>
  [...new Bun.Glob(glob).scanSync(ROOT)].map((file) => ({ file, text: code(readFileSync(join(ROOT, file), "utf8")) }));

const matching = (files: { file: string; text: string }[], needle: RegExp, except?: string): string[] =>
  files.filter((f) => f.file !== except && needle.test(f.text)).map((f) => f.file);

describe("one button, one button link, one message line", () => {
  const render = read("src/render/**/*.ts");
  const serve = read("src/serve/**/*.ts");
  const client = read("src/specs-client/**/*.ts");
  const all = [...render, ...serve, ...client];

  test("the globs found the sources at all", () => {
    // A guard that silently matches nothing passes forever.
    expect(render.length).toBeGreaterThan(15);
    expect(serve.length).toBeGreaterThan(15);
    expect(client.length).toBeGreaterThan(15);
  });

  test("no file but the button component writes a button with the btn class (AC-1)", () => {
    expect(matching(all, /<button\b[^>]*class=\\?"btn\b/, BUTTON)).toEqual([]);
  });

  test("no file but the button component writes a link with the btn class (AC-2)", () => {
    expect(matching(all, /<a\b[^>]*class=\\?"btn\b/, BUTTON)).toEqual([]);
  });

  test("no element anywhere is given the btn class by hand, so none is made to look like a button (AC-4)", () => {
    expect(matching(all, /class=\\?"btn\b/)).toEqual([]);
  });

  test("no file but the message component writes a message line (AC-3)", () => {
    expect(matching(all, /rowmsg|class=\\?"refused/, MESSAGE)).toEqual([]);
  });
});
