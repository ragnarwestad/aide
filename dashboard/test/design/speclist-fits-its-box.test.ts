// The specs list keeps growing a horizontal scrollbar, and every time
// for the same shape: the box and the table each stated a width, and
// the two had to agree on the pixel. The table's own 1px border was the
// first pixel to break it; the box's VERTICAL scrollbar — which appears
// the moment the list is long enough — was the next, and that one comes
// and goes with how many rows the list has.
//
// So only the BOX states a width now, and the table takes what the box
// has. The tests below pin that there is no second number to fall out
// of step with the first.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STEP_LABELS, STEP_LABELS_NB } from "../../src/render/ui/components.ts";

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

  // The Spec column carries a phase line's name and nothing else, and a
  // name wider than the column spills into the cell beside it — which is
  // what the Norwegian labels did to a column measured for "implement"
  // (2026-09-09). Every label in both catalogues has to fit.
  //
  // 7.4px per character at the list's own 13.5px sans (tokens.css,
  // --fs-m), rounded up from what a UI sans averages for lowercase —
  // an estimate, deliberately generous, and the point is the ALARM: a
  // label long enough to fail this is a label worth looking at in a
  // browser, whatever the exact metric turns out to be.
  test("the Spec column holds the longest phase name in either language", () => {
    const px = (rem: number) => rem * 16;
    const spec = rem(/col\[data-col="spec"\] \{ width: ([\d.]+)rem/.exec(css)![1]!);
    // `th, td` pads on the right only, so that is what the name loses.
    const padding = rem(/--sp-3: (\d+)px/.exec(
      readFileSync(new URL("../../src/render/ui/css/tokens.css", import.meta.url), "utf8"),
    )![1]!);
    const room = px(spec) - padding;

    const labels = [...Object.values(STEP_LABELS), ...Object.values(STEP_LABELS_NB)];
    const longest = labels.reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length * 7.4).toBeLessThanOrEqual(room);
  });

  // And the box holds that sum PLUS the table's border. The two pixels
  // look like slack and are not: `table-layout: fixed` makes the table's
  // used width the sum of the columns whatever `width` says, and
  // `border-collapse: collapse` draws the outer border's outer half
  // beyond it, where `box-sizing` does not reach. Measured in Chromium:
  // without them, one pixel of horizontal scrollbar (2026-09-09).
  test("the scrolling box holds the column sum plus the table's border", () => {
    const wrap = /#jobrows \.tablewrap \{[^}]*max-width: ([^;]+);/.exec(css)![1]!.trim();
    expect(wrap).toBe("calc(var(--speclist-width) + 2px)");
    expect(css).toMatch(/table\.list \{[^}]*border: 1px solid/);
  });

  // And the table takes the box's width, border included. A rem width
  // of its own — `--speclist-width`, or anything derived from it — is
  // the second number this whole file exists to keep out.
  test("the table takes the box's width rather than stating one", () => {
    const rule = /table\.speclist \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/width: 100%/);
    expect(rule).toMatch(/box-sizing: border-box/);
    expect(rule).toMatch(/table-layout: fixed/);
    expect(rule).not.toMatch(/rem|--speclist-width|calc\(/);
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

  // Every row type in the State column now centres in the same
  // symmetric box: the state badge, the phase lines' dash and the
  // caption line's action button all share the general rule instead of
  // the caption line alone carrying its own centering override.
  test("the State column centres every row type in the same symmetric box", () => {
    const cell = /table\.list td\[data-col="state"\] \{([^}]*)\}/.exec(css)![1]!;
    expect(cell).toMatch(/text-align: center/);
    const left = /padding-left: var\(--(sp-\d)\)/.exec(cell)![1]!;
    const right = /padding-right: var\(--(sp-\d)\)/.exec(cell)![1]!;
    expect(right).toBe(left);
    // And the slot inside the caption line still gives up its fixed
    // width, which is wider than what the clearance leaves on either
    // side: a slot that keeps it fills the cell and there is nothing
    // left to centre.
    expect(css).toContain(
      'table.list tr.subrow[data-caption="1"] td[data-col="state"] > .actionslot { width: auto; }',
    );
  });

  // The dash used to need a manual left indent because it sat alone in
  // a left-aligned column; now every element in the column centres, so
  // the compensation is gone.
  test("the State column's dash needs no manual indent", () => {
    expect(css).not.toContain('table.list td[data-col="state"] [data-none] { margin-left: 4ch; }');
  });

  // A sortable header's chevron sits at the column's own right edge,
  // clear of the label, instead of shrink-wrapping directly against it.
  test("a sortable header's chevron sits at the column's right edge", () => {
    const rule = /\.sortlink \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/display: flex/);
    expect(rule).toMatch(/width: 100%/);
    expect(rule).toMatch(/justify-content: space-between/);
  });
});
