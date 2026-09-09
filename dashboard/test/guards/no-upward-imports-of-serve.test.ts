// serve depends on queue, render, git, project and i18n — never the
// reverse (architecture review, 2026-09-09). Nothing enforced that
// direction before this test: a stray `from "../serve/..."` in one of
// these layers would compile and pass every other test.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const GUARDED_DIRS = ["src/render", "src/queue", "src/git", "src/project", "src/i18n"];

const SOURCES = GUARDED_DIRS.flatMap((dir) => [...new Bun.Glob(`${dir}/**/*.ts`).scanSync(ROOT)]);

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

function serveImportsIn(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf-8");
  const hits: string[] = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    const resolved = normalize(join(dirname(file), spec));
    if (resolved === "src/serve" || resolved.startsWith("src/serve/") || resolved.startsWith("src/serve.ts")) {
      hits.push(spec);
    }
  }
  return hits;
}

describe("render, queue, git, project and i18n never import from serve", () => {
  test("the glob found the sources at all", () => {
    // A guard that silently matches nothing passes forever.
    expect(SOURCES.length).toBeGreaterThan(80);
  });

  for (const file of SOURCES) {
    test(`${file} does not import src/serve`, () => {
      expect(serveImportsIn(file)).toEqual([]);
    });
  }
});
