// The header's unit, language and theme controls come into the "…"
// menu one at a time as the page narrows, at the same three widths the
// specs list drops Created, Cost and Time (2026-09-11) — one set of
// steps for the whole page, not two.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("../../../src/render/ui/css/list.css", import.meta.url), "utf8");
const narrow = readFileSync(new URL("../../../src/render/ui/css/narrow.css", import.meta.url), "utf8");

const stepsOf = (css: string, body: RegExp) =>
  [...css.matchAll(new RegExp(`@media \\(max-width: ([\\d.]+)rem\\) \\{\\s*${body.source}`, "g"))].map((m) => [parseFloat(m[1]!), m[2]!]);

describe("unit, language and theme leave the header one at a time", () => {
  const header = stepsOf(narrow, /\.menu\.(\w+) \{ display: none; \}\s*\.menu \.morerows\.\w+ \{ display: flex; \}/);

  test("unit first, then language, then theme", () => {
    expect(header.map((s) => s[1])).toEqual(["unit", "lang", "theme"]);
  });

  test("the list drops its figure columns at the menu's last two steps", () => {
    const columns = stepsOf(list, /#jobrows \{ --speclist-width: [\d.]+rem; \}\s*table\.speclist th\[data-col="(\w+)"\]/);
    expect(columns.map((s) => s[1])).toEqual(["cost", "started"]);
    expect(header.slice(1).map((s) => s[0])).toEqual(columns.map((s) => s[0]));
  });

  test("each step reveals the menu's copy of the one control it hides", () => {
    for (const m of narrow.matchAll(/\.menu\.(\w+) \{ display: none; \}\s*\.menu \.morerows\.(\w+) \{ display: flex/g)) {
      expect(m[2]).toBe(m[1]);
    }
  });
});
