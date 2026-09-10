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
});
