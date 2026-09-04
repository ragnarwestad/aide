// A source file git classifies as BINARY cannot be reviewed: no diff,
// no line comments, "Bin 0 -> 5578 bytes" and nothing else. That is
// what one NUL byte inside a template literal did to
// `src/branch-status.ts` — a deliberate, sensible cache-key separator
// with a consequence nobody weighed. Unambiguous keys have plain-text
// spellings; use one.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const SOURCES = [
  ...[...new Bun.Glob("src/**/*.ts").scanSync(ROOT)],
  ...[...new Bun.Glob("test/**/*.ts").scanSync(ROOT)],
  ...[...new Bun.Glob("deploy/**/*.ts").scanSync(ROOT)],
];

describe("every source file is text git can diff", () => {
  test("the glob found the sources at all", () => {
    // A guard that silently matches nothing passes forever.
    expect(SOURCES.length).toBeGreaterThan(15);
  });

  for (const file of SOURCES) {
    test(`${file} contains no NUL byte`, async () => {
      const bytes = new Uint8Array(await Bun.file(join(ROOT, file)).arrayBuffer());
      expect(bytes.indexOf(0)).toBe(-1);
    });
  }
});
