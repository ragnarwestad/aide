// Every badge in the State column takes one width, the text centred
// in it, so the column reads as equal chips (2026-09-10). A floor, not
// a fixed width: the long stopped-texts still grow past it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/render/ui/css/status-badge.css", import.meta.url), "utf8");

describe("the State column's badges share one width", () => {
  test("a min-width and centred text, scoped to the State column", () => {
    const rule = /table\.list td\[data-col="state"\] \.badge \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/min-width: [\d.]+rem/);
    expect(rule).toMatch(/justify-content: center/);
    expect(rule).toMatch(/box-sizing: border-box/);
    expect(rule).not.toMatch(/[^-]width:/);
    // The cell's content box is exactly the badge's width: 9rem column,
    // 12px of padding a side, 7.5rem badge — centred on every row.
    const list = readFileSync(new URL("../../src/render/ui/css/list.css", import.meta.url), "utf8");
    const cell = /table\.list td\[data-col="state"\] \{([^}]*)\}/.exec(list)![1]!;
    expect(cell).toMatch(/padding-left: var\(--sp-3\); padding-right: var\(--sp-3\)/);
    expect(cell).toMatch(/text-align: center/);
  });

  // The pips over the badge (a shut row) share its width, so the two
  // centre on each other even where the column is narrower than both.
  test("a shut row's pips take the badge's width", () => {
    const badge = /table\.list td\[data-col="state"\] \.badge \{ min-width: ([\d.]+rem)/.exec(css)![1];
    expect(css).toContain(`table.list tr.spechead .pipslot { min-width: ${badge}; }`);
  });
});

describe("on a phone the badges are their own width again", () => {
  test("narrow.css takes the min-width off inside its media block", () => {
    const narrow = readFileSync(new URL("../../src/render/ui/css/narrow.css", import.meta.url), "utf8");
    const block = narrow.slice(narrow.indexOf("@media (max-width: 40rem) {"));
    expect(block).toContain('table.list td[data-col="state"] .badge { min-width: 0; }');
    expect(block).toContain('table.list td[data-col="state"] { padding-left: 0; padding-right: 0; }');
  });
});
