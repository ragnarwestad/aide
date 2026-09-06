import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Spec 408, REQ-5: every pageShell( call site under render/pages/ must
// itself pass some `lang` — the compiler cannot enforce this (lang stays
// optional throughout, see 2-analysis.md), so a tenth page that forgets
// to wire it is caught here instead.
function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFilesUnder(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

function pageShellCallArgs(text: string): string[] {
  const args: string[] = [];
  const marker = "pageShell(";
  let from = 0;
  while (true) {
    const at = text.indexOf(marker, from);
    if (at === -1) break;
    let depth = 1;
    let i = at + marker.length;
    while (depth > 0 && i < text.length) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    args.push(text.slice(at + marker.length, i - 1));
    from = i;
  }
  return args;
}

describe("every pageShell call passes a real language (spec 408, REQ-5)", () => {
  const pagesDir = join(import.meta.dir, "../../../src/render/pages");
  const callsByFile = tsFilesUnder(pagesDir)
    .map((file) => ({ file, calls: pageShellCallArgs(readFileSync(file, "utf-8")) }))
    .filter((f) => f.calls.length > 0);

  test("at least 17 pageShell call sites are found (the scan itself is working)", () => {
    const total = callsByFile.reduce((n, f) => n + f.calls.length, 0);
    expect(total).toBeGreaterThanOrEqual(17);
  });

  test("every call site names lang, and none of them writes lang: undefined", () => {
    const bad: string[] = [];
    for (const { file, calls } of callsByFile) {
      calls.forEach((args, i) => {
        if (!/\blang\b/.test(args) || /\blang\s*:\s*undefined\b/.test(args)) {
          bad.push(`${file} (call #${i + 1})`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
