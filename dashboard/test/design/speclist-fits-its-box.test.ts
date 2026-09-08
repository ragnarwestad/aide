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

  // The checkbox stands under the middle of the word "Select", not at
  // the left edge of a chip wider than it. Three things have to agree
  // for that, and each is undone by an innocent-looking edit elsewhere:
  // the caption and the box are the same width, both centre what they
  // hold, and the caption line's own spacing puts the two at the same
  // x — the phase line keeps its two selects in one wrapper with no gap
  // between them, so the caption line drops the gap and re-adds the one
  // before the box as a margin.
  test("the Select caption and the phase box are one column, centred", () => {
    const cap = /\.row > \[data-cap="box"\] \{([^}]*min-width[^}]*)\}/.exec(css)![1]!;
    const box = /\.row > \.phase\[data-phase\] \{([^}]*min-width[^}]*)\}/.exec(css)![1]!;

    const width = (rule: string) => {
      const min = /min-width: ([\d.]+)rem/.exec(rule)![1]!;
      const max = /max-width: ([\d.]+)rem/.exec(rule)![1]!;
      expect(min).toBe(max);
      return rem(min);
    };
    expect(width(cap)).toBeCloseTo(width(box), 5);

    // Centred inside that width: text for the caption, flex for the
    // chip — and the chip measured from its border box, or its padding
    // is added to the width and the two stop matching.
    expect(cap).toMatch(/text-align: center/);
    expect(box).toMatch(/justify-content: center/);
    expect(box).toMatch(/box-sizing: border-box/);
    // The chip's empty label span is a flex item too: a gap to it moves
    // the checkbox off the centre it was just given.
    expect(box).toMatch(/gap: 0/);

    // And the same starting x. The caption line has one caption per
    // control where the phase line has one wrapper for two of them, so
    // it can only line up by dropping the row's gap and paying it back
    // once, before the box.
    expect(css).toContain(
      'table.list tr.subrow[data-caption="1"] .modelcell > .row { gap: 0; }',
    );
    expect(css).toContain(
      'table.list tr.subrow[data-caption="1"] .modelcell > .row > [data-cap="box"] { margin-left: var(--sp-2); }',
    );
  });

  // The State column pays its clearance on one side only, so a cell
  // that centres its content without paying it on the other centres in
  // what is LEFT of the column rather than in the column. The action
  // button is the one thing drawn that way.
  test("the caption line's action is centred in the State column, not beside it", () => {
    const cell =
      /tr\.subrow\[data-caption="1"\] td\[data-col="state"\] \{([^}]*)\}/.exec(css)![1]!;
    expect(cell).toMatch(/text-align: center/);
    const pad = /padding-left: var\(--(sp-\d)\)/.exec(
      /table\.list td\[data-col="state"\] \{([^}]*)\}/.exec(css)![1]!,
    )![1]!;
    expect(cell).toContain(`padding-right: var(--${pad})`);
  });

  // A badge carries its own padding and a bare dash carries none, so
  // the two start at different places in the same column unless the
  // dash is indented — which is what `data-none` is on it for.
  test("the State column's dash is indented to where the badges' words start", () => {
    expect(css).toContain('table.list td[data-col="state"] [data-none] { margin-left: 4ch; }');
  });
});
