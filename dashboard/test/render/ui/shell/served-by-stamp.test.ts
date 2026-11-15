// The stamp a page carries in its `aide-served-by` meta: the page swap loads
// a page whole when the stamp differs from the one it came with, so the
// stamp changes when the code the page runs changes, and only then.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import { setClientBundle, shellHead } from "../../../../src/render/ui/shell.ts";

const stampOf = (html: string): string => html.match(/<meta name="aide-served-by" content="([^"]*)">/)?.[1] ?? "";

afterEach(() => setClientBundle(""));

test("two server processes with the same page code give their pages the same stamp", () => {
  const shell = join(import.meta.dir, "../../../../src/render/ui/shell.ts");
  const script = `const s = await import(${JSON.stringify(shell)}); s.setClientBundle("bundle"); console.log(s.shellHead("Jobs"));`;
  const run = () => stampOf(Bun.spawnSync([process.execPath, "-e", script]).stdout.toString());
  const first = run();
  expect(first).not.toBe("");
  expect(run()).toBe(first);
});

test("a changed page script changes the stamp", () => {
  setClientBundle("bundle one");
  const before = stampOf(shellHead("Jobs"));
  setClientBundle("bundle two");
  expect(stampOf(shellHead("Jobs"))).not.toBe(before);
});

test("the words the page script reads from the body are part of the stamp", () => {
  setClientBundle("bundle");
  expect(stampOf(shellHead("Jobs", { lang: "en" }))).not.toBe(stampOf(shellHead("Jobs", { lang: "nb" })));
});
