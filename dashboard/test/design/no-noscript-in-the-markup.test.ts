// Nothing the board renders is built for a reader with scripting off:
// there is no `<noscript>` anywhere in the markup, and no second
// rendering of a control for one. A page arrives fully drawn and its
// controls are the page's own HTML, which is what makes a press work in
// the moment before the script attaches and a failed bundle build leave
// the page working — neither of those needs a `<noscript>`.
//
// This guard is the one place that keeps it out: a `<noscript>` added
// later parses fine, renders fine, and says nothing about itself.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "src");

function allFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...allFilesUnder(full));
    else if (full.endsWith(".ts") || full.endsWith(".css")) out.push(full);
  }
  return out;
}

describe("no <noscript> in what the board renders", () => {
  test("no source file writes one", () => {
    const named = allFilesUnder(SRC)
      .filter((file) => readFileSync(file, "utf-8").includes("<noscript"))
      .map((file) => relative(ROOT, file));
    expect(named).toEqual([]);
  });
});
