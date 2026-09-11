// The header's unit, language and theme controls come into the "…"
// menu one at a time as the page narrows, at the same three widths the
// specs list drops Created, Cost and Time (2026-09-11) — one set of
// steps for the whole page, not two.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("../../src/render/ui/css/list.css", import.meta.url), "utf8");
const narrow = readFileSync(new URL("../../src/render/ui/css/narrow.css", import.meta.url), "utf8");

const stepsOf = (css: string, body: RegExp) =>
  [...css.matchAll(new RegExp(`@media \\(max-width: ([\\d.]+)rem\\) \\{\\s*${body.source}`, "g"))].map((m) => [parseFloat(m[1]!), m[2]!]);

describe("unit, language and theme leave the header one at a time", () => {
  const header = stepsOf(narrow, /\.menu\.(\w+) \{ display: none; \}\s*\.menu \.morerows\.\w+ \{ display: flex; flex-direction: column; gap: 2px; \}/);

  test("unit first, then language, then theme", () => {
    expect(header.map((s) => s[1])).toEqual(["unit", "lang", "theme"]);
  });

  test("at the same widths the list drops its figure columns", () => {
    const columns = stepsOf(list, /#jobrows \{ --speclist-width: [\d.]+rem; \}\s*table\.speclist th\[data-col="(\w+)"\]/);
    expect(columns.map((s) => s[1])).toEqual(["created", "cost", "started"]);
    expect(header.map((s) => s[0])).toEqual(columns.map((s) => s[0]));
  });

  test("each step reveals the menu's copy of the one control it hides", () => {
    for (const m of narrow.matchAll(/\.menu\.(\w+) \{ display: none; \}\s*\.menu \.morerows\.(\w+) \{ display: flex/g)) {
      expect(m[2]).toBe(m[1]);
    }
  });
});

// At phone width the board's name stays in the header to the last and
// only its Stop button moves into the "…" menu; the wordmark never
// wraps, the name is what gives way.
describe("the board's name stays in the phone header, Stop moves into the menu", () => {
  const at = narrow.indexOf("@media (max-width: 40rem) {");
  const phone = narrow.slice(at);
  test("the header hides only the Stop form", () => {
    expect(phone).toContain("header > .boardline > .actionform { display: none; }");
    expect(phone).not.toMatch(/header > \.boardline \{ display: none/);
    expect(phone).toContain(".menupanel > .boardrow { display: flex;");
  });
  test("the wordmark keeps its line and the name gives way", () => {
    expect(phone).toContain("header .brand { flex: none; white-space: nowrap; }");
    expect(phone).toMatch(/header > \.boardline \{ flex: 1 1 auto; min-width: 0;/);
  });
});
