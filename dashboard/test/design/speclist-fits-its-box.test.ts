// The specs list drew a horizontal scrollbar that scrolled one pixel.
// The six column widths sum to exactly `--speclist-width`, and
// `table.list` draws a 1px border around them — so a box capped at the
// bare number is narrower than the table inside it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/render/ui/css/list.css", import.meta.url), "utf8");
const rem = (v: string) => parseFloat(v);

describe("the specs table fits the box that scrolls it", () => {
  // The stated width has to stay the sum of the columns: `table-layout:
  // fixed` sizes from it, and a number that drifts from the sum leaves
  // one column absorbing the difference.
  test("--speclist-width is the sum of the six column widths", () => {
    const stated = rem(/--speclist-width: ([\d.]+)rem/.exec(css)![1]!);
    const cols = [...css.matchAll(/col\[data-col="\w+"\] \{ width: ([\d.]+)rem/g)].map((m) => rem(m[1]!));
    expect(cols).toHaveLength(6);
    expect(cols.reduce((a, b) => a + b, 0)).toBeCloseTo(stated, 5);
  });

  // And the box has to hold the table's border on top of that sum, or
  // the browser draws a scrollbar for the difference.
  test("the scrolling box is the table's width plus its border", () => {
    const wrap = /#jobrows \.tablewrap \{[^}]*max-width: ([^;]+);/.exec(css)![1]!.trim();
    expect(wrap).toBe("calc(var(--speclist-width) + 2px)");
    expect(css).toMatch(/table\.list \{[^}]*border: 1px solid/);
  });

  // Spec 415, REQ-1: a flex item inside #jobrows's column flex container
  // stretches to the container's full cross width and is then clamped by
  // its own max-width, but stays left-flush unless it also carries an
  // explicit width plus auto cross-margins (page.css's own centering
  // recipe, spec 325) to redistribute the leftover space.
  test("#jobrows .tablewrap and #jobrows .specsearch both center themselves", () => {
    const wrap = /#jobrows \.tablewrap \{[^}]*\}/.exec(css)![0]!;
    expect(wrap).toMatch(/width: 100%/);
    expect(wrap).toMatch(/box-sizing: border-box/);
    expect(wrap).toMatch(/margin-inline: auto/);

    const search = /#jobrows \.specsearch \{[^}]*\}/.exec(css)![0]!;
    expect(search).toMatch(/width: 100%/);
    expect(search).toMatch(/box-sizing: border-box/);
    expect(search).toMatch(/margin-inline: auto/);
  });

  // Spec 415, REQ-3: the New-spec page's AI/Model table has the same
  // narrow-content-columns complaint .settingstable already fixed
  // (spec 409) — scoped by the page's own form id rather than a new
  // class, since it shares plain table.list with the Specs list.
  test("the New-spec page's phase table does not stretch to the page's full width", () => {
    expect(css).toContain("#new-spec-form table.list { width: auto; }");
  });
});
