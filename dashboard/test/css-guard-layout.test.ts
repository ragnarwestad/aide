// Split out of css-token-guard.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { CSS, oneRule } from "./css-guard-fixtures.ts";

// --- the gap lives in the container (spec 120) ------------------------------
//
// A component that brings its own margin decides the spacing of every
// layout it is ever put in, and the layout it is put in next cannot
// take it back. The four rules below sat beside each other on the two
// lines this page crowds most, each with a `margin-left` standing in
// for a gap their container should have declared once. The guard above
// checks class NAMES and never rule bodies, so nothing else in the
// suite would notice one creeping back.

describe("the space between two controls comes from their container", () => {
  const GAPLESS = [".mergeform", ".actionform", ".extra"];

  for (const cls of GAPLESS) {
    test(`${cls} declares no margin of its own`, () => {
      // A rule that is gone entirely passes: `.actionform`'s margin was
      // its only declaration, and `td form` already gives it the rest.
      const body = CSS.match(new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect([cls, body.includes("margin")]).toEqual([cls, false]);
    });
  }

  // `.spin` is 12x12 with a border-radius, and it carries `flex: none` —
  // it is written as a flex or grid ITEM. A `<span>` is inline by
  // default, and width and height do not apply to an inline box, so a
  // spinner dropped straight into a plain block collapses to a sliver.
  // Inside a `.btn` the button's own `inline-flex` blockifies it; the
  // loading overlay has to do the same for itself (reported on spec 314,
  // 2026-09-01, where it drew as a thin bar in the middle of the page).
  test("the loading overlay lays its spinner out, so the spinner's own size applies", () => {
    const body = CSS.match(/dialog\.pageoverlay\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/display:\s*(flex|grid|inline-flex|inline-grid)/);
  });

  test("the row's own alignment rule stays scoped, and the filter bar keeps its own", () => {
    // The controls line the flex-end rule was written for is gone
    // (spec 124), and with it the selector — a guard left pointing at
    // `tr[data-controls]` would pass for ever without protecting
    // anything. `.row`'s own unscoped `center` is what the filter bar
    // still needs and must not be replaced by a row-shaped rule.
    expect(CSS).not.toContain("data-controls");
    expect(CSS).toMatch(/\.row\s*\{[^}]*align-items:\s*center[^}]*\}/);
  });

  // Spec 167. `.actionslot` has reserved a fixed width since spec 157,
  // but the badge in FRONT of it has none — "not started", "analyzing",
  // "archive held back", "done — nothing waiting on you" — so the
  // buttons started at different x positions down the column and moved
  // as a state changed. `space-between` puts the action against the
  // column's right edge whatever the badge says, and costs no reserved
  // space at all.
  //
  // Static rule, not a rendered comparison: whether two badges of
  // different lengths anchor their buttons to the same pixel needs a
  // browser. What this proves is that the rule exists, and that it is
  // scoped to the State cell's row rather than added to the shared
  // `.row {}` the phase lines and the filter bar also use.
  test("the State cell's action is pushed to the column's right edge, scoped", () => {
    expect(CSS).toMatch(
      /table\.list tr\.spechead > td > \.row \{[^}]*justify-content:\s*space-between[^}]*\}/,
    );
    // The shared rule keeps its own alignment and gains nothing.
    expect(CSS.match(/\n\.row \{([^}]*)\}/)?.[1] ?? "").not.toContain("justify-content");
  });
});

// --- the row's action cannot widen a column (spec 124, spec 157) -----------
//
// The button a row offers comes and goes with its state, and the cell
// it sits in must not be sized by whichever label is longest: a column
// that grows to fit one row's button moves every other row on the page.
// Spec 124 answered that with a declared width on a cell of the
// buttons' own — a COLUMN at the front of the table first, which
// pushed every other column sideways, then the spec column's own cell
// spanning the phase lines (2026-08-19).
//
// Spec 157 answers it by wrapping instead. One button per row, in the
// State column, sharing the page's ordinary `row` container with the
// badge — and that container wraps, so a long pairing becomes two
// lines rather than a wider column.

describe("the row's action wraps rather than widening a column", () => {
  test("no cell of the buttons' own is left to declare a width on", () => {
    expect(CSS).not.toContain("stackcell");
    expect(CSS).not.toMatch(/\.stack \{/);
  });

  test("the container the badge and button share wraps, with the gap it always had", () => {
    const rule = CSS.match(/\n\.row \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("flex-wrap: wrap");
    expect(rule).toMatch(/gap:\s*var\(--sp-\d\)/);
    expect(rule).not.toContain("margin");
  });
});

// --- the Config tab's button row sits at the right, with a real gap
// below it (spec 301) --------------------------------------------------

describe("the Config tab's button row is right-aligned with a deliberate margin", () => {
  test(".configactions is right-aligned and its gap to the table below is a token, not a literal", () => {
    const rule = CSS.match(/\.configactions \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("justify-content: flex-end");
    expect(rule).toMatch(/margin-bottom:\s*var\(--sp-\d\)/);
  });
});

// --- the unit a reader chose (spec 118) -------------------------------------
//
// The same trick as the theme, applied to text instead of colour: every
// consumption figure is rendered twice and CSS hides one. Both rules are
// needed and neither is obvious — the second is a `:not()`, which is
// what makes dollars the default without an attribute to select on — so
// deleting either fails here with a reason.

// --- the state trigger carries a fill and a border at rest, and sits
// at the right end of the controls line (spec 305) --------------------

describe("the state trigger reads as a control, not plain text", () => {
  test(".menu.state > summary declares a fill and a border at rest", () => {
    const rule = CSS.match(/\.menu\.state > summary \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--surface\)/);
    expect(rule).toMatch(/border:\s*1px solid var\(--line-strong\)/);
  });

  test(".menu.state > summary:hover changes the border colour, distinct from rest", () => {
    const hover = CSS.match(/\.menu\.state > summary:hover \{([^}]*)\}/)?.[1] ?? "";
    expect(hover).toMatch(/border-color:\s*var\(--muted\)/);
  });

  test(".specsearch > .btn.primary carries the auto margin, .menu.state no longer does", () => {
    expect(CSS).toMatch(/\.specsearch > \.btn\.primary \{[^}]*margin-left:\s*auto[^}]*\}/);
    expect(CSS).not.toMatch(/\.specsearch > \.menu\.state \{[^}]*margin-left:\s*auto[^}]*\}/);
  });

  test("the panel carries no left-anchoring override, so it falls back to the base right anchor", () => {
    expect(CSS).not.toMatch(/\.menu\.state \.menupanel \{[^}]*left:\s*0[^}]*\}/);
  });

  test(".menu.state .check is round, not square", () => {
    const rule = CSS.match(/\.menu\.state \.check \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/border-radius:\s*50%/);
    expect(rule).not.toMatch(/border-radius:\s*3px/);
  });

  test("the filled mark is selected by aria-checked=true, not aria-current", () => {
    expect(CSS).toContain(".menu.state a[aria-checked=\"true\"] .check");
    expect(CSS).not.toMatch(/\.menu\.state a\[aria-current\]/);
  });
});

// --- the Spec column alone gets the table's spare width (REQ-5/REQ-6,
// spec 339) --------------------------------------------------------------
//
// An auto-layout table hands its leftover width to whichever columns
// declare no preference. State, Created, Time and Cost each pin their
// header to `width: 1%`, which floors them at their own content and
// stops them sharing in the surplus; Spec carries no such pin, so it
// is the one column left to receive it — the one column whose content
// (a folder name) actually varies in length. This reverses spec 336's
// own version of this rule, which pinned Spec and left State free.

describe("the Spec column alone gets the table's spare width", () => {
  test("State, Created, Time and Cost are pinned to their content width, Spec is not", () => {
    const rule = oneRule(CSS, (r) => r.selectors.includes('th[data-col="state"]'));
    expect(rule.selectors).toContain('th[data-col="created"]');
    expect(rule.selectors).toContain('th[data-col="started"]');
    expect(rule.selectors).toContain('th[data-col="cost"]');
    expect(rule.selectors).not.toContain('data-col="spec"');
    expect(rule.body).toContain("width: 1%");
  });
});

// The pin above is only as wide as its content can be LAID OUT, and a
// row that may wrap lays out two lines tall — badge over button. That is
// what 339's own landing looked like. The State cell's row must not wrap.
describe("the State cell's badge and button stay on one line", () => {
  test("the spec row's .row is flex-wrap: nowrap", () => {
    // Two rules share the selector: the desktop one, and narrow.css's
    // phone override (justify-content: flex-start). The desktop one is
    // the one that pairs with the width pin.
    const rule = oneRule(
      CSS,
      (r) => r.selectors.includes("table.list tr.spechead > td > .row") && r.body.includes("space-between"),
    );
    expect(rule.body).toContain("flex-wrap: nowrap");
  });
});

// --- the specs list ends at the window edge in the installed app too
// (spec 375) -------------------------------------------------------------
//
// body:has(#jobrows) sets height: 100vh with the default content-box
// sizing, so the window-controls-overlay media query's padding-top adds
// ON TOP of that height instead of being counted inside it — the body
// renders taller than the window by exactly the titlebar height, and the
// scroll box inside it (list.css's #jobrows .tablewrap) ends that far
// below the window's bottom edge. border-box makes the declared height
// include any padding on the same rule, present or future.

describe("the specs page body counts its own padding, so it never outgrows the window", () => {
  test("body:has(#jobrows) is box-sizing: border-box", () => {
    const rule = CSS.match(/body:has\(#jobrows\) \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  // Scrolled to the end, the last row's own bottom border sat flush
  // against the scroll box's edge with nothing to separate the two.
  test("#jobrows .tablewrap carries a bottom margin below the last row", () => {
    const rule = CSS.match(/#jobrows \.tablewrap \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/padding-bottom:\s*var\(--sp-3\)/);
  });
});

describe("the unit a reader chose is a CSS switch, not a second page", () => {
  test("choosing tokens hides the dollar figure", () => {
    expect(CSS).toContain(':root[data-unit="tokens"] .u-usd { display: none; }');
  });

  test("with no choice made the token figure is the hidden one", () => {
    // `:not([data-unit="tokens"])`, not `[data-unit="usd"]`: dollars is
    // the ABSENCE of the attribute, exactly as Auto is for the theme, so
    // a page whose script never ran still reads the way it always did.
    expect(CSS).toContain(':root:not([data-unit="tokens"]) .u-tok { display: none; }');
  });
});
