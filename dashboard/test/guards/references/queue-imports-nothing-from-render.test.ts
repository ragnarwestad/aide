// The queue's rules decide from a spec's facts, never from a type the
// pages own: nothing under src/queue/ imports from src/render/.
import { describe, expect, test } from "bun:test";
import { dirname, join, normalize } from "node:path";
import { read } from "../source.ts";

const SOURCES = read("src/queue/**/*.ts");
const IMPORT_RE = /from\s+["']([^"']+)["']/g;

function renderImportsIn(file: string, text: string): string[] {
  const hits: string[] = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1]!;
    if (!spec.startsWith(".")) continue;
    const resolved = normalize(join(dirname(file), spec));
    if (resolved === "src/render" || resolved.startsWith("src/render/") || resolved.startsWith("src/render.ts")) hits.push(spec);
  }
  return hits;
}

describe("the queue imports nothing from render", () => {
  test("the glob found the sources at all", () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  test("no source under src/queue/ imports src/render (AC-1)", () => {
    const offenders = SOURCES.flatMap(({ file, text }) => renderImportsIn(file, text).map((spec) => `${file}: ${spec}`));
    expect(offenders).toEqual([]);
  });
});
