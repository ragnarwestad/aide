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
import { en } from "../../src/i18n/en.ts";
import { nb } from "../../src/i18n/nb.ts";
import { PHASE_TAB } from "../../src/render/pages/spec-page/tabs.ts";

const css = readFileSync(new URL("../../src/render/ui/css/list.css", import.meta.url), "utf8");
const rem = (v: string) => parseFloat(v);

describe("the specs table fits the box that scrolls it", () => {
  // The stated width has to stay the sum of the columns: `table-layout:
  // fixed` sizes from it, and a number that drifts from the sum leaves
  // one column absorbing the difference.
  // The columns are percentages of the table, and the table is 100% of
  // its box, so they scale with it and the table is never wider than its
  // room. Rem widths made a table that cannot shrink — `table-layout:
  // fixed` sizes the table to their SUM — and `auto` on one column made
  // it worse: the five fixed ones took the whole table and the auto one
  // was squeezed to 7px, with the phase name lying across the pickers
  // beside it (2026-09-09).
  // Four times over: the full list, and the three steps down that hide
  // one figure column each (Created, Cost, Time) — every set of six adds
  // up to the whole table, with the hidden columns at 0.
  test("the six columns are percentages, and they add up to the whole table", () => {
    const cols = [...css.matchAll(/col\[data-col="\w+"\] \{ width: ([\d.]+)%/g)].map((m) => rem(m[1]!));
    expect(cols).toHaveLength(24);
    for (let i = 0; i < cols.length; i += 6) {
      expect(cols.slice(i, i + 6).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    }
    expect(css).not.toMatch(/col\[data-col="\w+"\] \{ width: (auto|[\d.]+rem)/);
  });

  // The figure columns leave one at a time from the right, each step
  // taking the column's 6.5rem off the list's width so the others keep
  // their pixel widths, and the last step lands at the phone's own room
  // (40rem less the page's 2 × 32px = 36rem).
  test("Created, Cost and Time leave one at a time, each taking its width with it", () => {
    const steps = [...css.matchAll(/@media \(max-width: ([\d.]+)rem\) \{\s*#jobrows \{ --speclist-width: ([\d.]+)rem; \}\s*table\.speclist th\[data-col="(\w+)"\], table\.speclist td\[data-col="\w+"\] \{ display: none; \}/g)]
      .map((m) => ({ at: rem(m[1]!), width: rem(m[2]!), hides: m[3] }));
    expect(steps.map((s) => s.hides)).toEqual(["created", "cost", "started"]);
    expect(steps.map((s) => s.width)).toEqual([49, 42.5, 36]);
    // Each breakpoint is where the previous width stops fitting: the
    // list plus 4rem of page padding.
    expect(steps.map((s) => s.at)).toEqual([55.5 + 4, 49 + 4, 42.5 + 4]);
    expect(steps.every((s) => s.at > 40)).toBe(true);
  });

  // The Spec column carries a phase line's name and nothing else, and
  // every pixel it has beyond the longest of those names is empty space
  // between the name and the AI/Model pickers in the cell beside it. It
  // held 10rem for a day — measured for "manifestoppdatering", a step
  // almost no spec runs — and put ~100px of nothing on every ordinary
  // line (2026-09-09).
  //
  // So what has to fit is the FOUR steps a spec actually goes through,
  // not every label in the catalogue; a rarer, longer one spills into
  // the cell beside it, which percentages make possible without the
  // table growing.
  //
  // The widths are MEASURED, not estimated from character counts — the
  // labels differ too much per character for that ("tilbakestilling" is
  // 15 characters and narrower than "implementering"'s 14). Taken in
  // Chromium against this stylesheet at the list's own 13.5px sans. A
  // label not in the table below fails the test by name: measure it the
  // same way and add it, rather than guessing.
  test("the Spec column holds the four workflow steps' names in either language", () => {
    const px = (r: number) => r * 16;
    const stated = rem(/--speclist-width: ([\d.]+)rem/.exec(css)![1]!);
    const share = rem(/col\[data-col="spec"\] \{ width: ([\d.]+)%/.exec(css)![1]!) / 100;
    // `th, td` pads on the right only, so that is what the name loses.
    const padding = rem(/--sp-3: (\d+)px/.exec(
      readFileSync(new URL("../../src/render/ui/css/tokens.css", import.meta.url), "utf8"),
    )![1]!);
    const room = px(stated * share) - padding;

    // The four steps a spec goes through — `PHASE_TAB` is the list of
    // them, the ones with a tab of their own on the spec page.
    const MEASURED_PX: Record<string, number> = {
      create: 40, analyze: 48, implement: 66, archive: 46,
      oppretting: 66, analyse: 48, implementering: 98, arkivering: 62,
    };
    const shown = Object.keys(PHASE_TAB).flatMap((step) => [STEP_LABELS[step], STEP_LABELS_NB[step]])
      .filter((l): l is string => Boolean(l));
    for (const label of shown) {
      expect(`${label}: ${MEASURED_PX[label] ?? "not measured"}`).toBe(`${label}: ${MEASURED_PX[label]}`);
      expect(MEASURED_PX[label]!).toBeLessThanOrEqual(room);
    }
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
  // clear of the label, instead of shrink-wrapping directly against it
  // (spec 432): the chevron is positioned against the <th> itself, not
  // against .sortlink, so its own padding cannot carry the chevron past
  // the column's true edge.
  test("a sortable header's chevron sits at the column's right edge", () => {
    const th = /table\.speclist thead th \{([^}]*)\}/.exec(css)![1]!;
    expect(th).toMatch(/position: relative/);
    const rule = /\.sortlink \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/display: flex/);
    expect(rule).toMatch(/width: 100%/);
    expect(rule).toMatch(/box-sizing: border-box/);
    expect(rule).toMatch(/justify-content: center/);
    const svg = /\.sortlink svg \{([^}]*)\}/.exec(css)![1]!;
    expect(svg).toMatch(/position: absolute/);
    expect(svg).toMatch(/right: /);
    expect(svg).toMatch(/transform: translateY\(-50%\)/);
    const ascSvg = /\.sortlink\.asc svg \{([^}]*)\}/.exec(css)![1]!;
    expect(ascSvg).toMatch(/transform: translateY\(-50%\) rotate\(180deg\)/);
  });

  // Time, Cost/Tokens and Created used to fall into two different
  // defaults by accident — Time and Created left-aligned (the table's
  // own default), Cost/Tokens right-aligned (`.num`) — and none of the
  // three centred (REQ-1, spec 427). All three now state their own
  // centring, scoped to their own `data-col`, so no other column's
  // `.num` cell or `.sortlink` header is touched.
  test("Time, Cost/Tokens and Created values are centred", () => {
    for (const col of ["started", "cost", "created"]) {
      const cell = new RegExp(`table\\.list td\\[data-col="${col}"\\][^{]*\\{([^}]*)\\}`).exec(css)![1]!;
      expect(cell).toMatch(/text-align: center/);
    }
  });

  // Every sortable column shares one .sortlink rule (spec 432): no
  // column keeps a data-col-scoped override of its own any more.
  test("no sortable column keeps its own .sortlink override", () => {
    for (const col of ["spec", "state", "started", "cost", "created"]) {
      const overridePattern = new RegExp(`table\\.list th\\[data-col="${col}"\\] \\.sortlink`);
      expect(css).not.toMatch(overridePattern);
    }
  });

  // The reserved padding has to be wide enough for the chevron's own
  // footprint plus its inset from the <th> edge, and symmetric so the
  // centred label stays centred (spec 432, Risk analysis Risk 1) — a
  // future edit to either number cannot silently reopen a crowding
  // regression.
  test("the header link's padding is symmetric and clears the chevron", () => {
    const rule = /\.sortlink \{([^}]*)\}/.exec(css)![1]!;
    const padding = /padding: (\d+)px (\d+)px/.exec(rule)!;
    const horizontal = Number(padding[2]);
    const svg = /\.sortlink svg \{([^}]*)\}/.exec(css)![1]!;
    const right = Number(/right: (\d+)px/.exec(svg)![1]);
    const chevronWidth = 14;
    expect(horizontal).toBeGreaterThanOrEqual(right + chevronWidth);
  });

  // REQ-2/REQ-3: the Spec column's header spells out the full word in
  // both languages — English used to read the abbreviation "Spec",
  // Norwegian already read "Spesifikasjon".
  test("the Spec column header spells out the full word in both languages", () => {
    expect(en["list.colSpec"]).toBe("Specification");
    expect(nb["list.colSpec"]).toBe("Spesifikasjon");
  });
});
