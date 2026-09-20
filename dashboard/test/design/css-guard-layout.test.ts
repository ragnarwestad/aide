// Split out of css-token-guard.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { CSS, oneRule, rules } from "./css-guard-fixtures.ts";

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

  // The badge and the button shared one cell until 2026-09-07, and each
  // carried an exact width so the button started at the same x on every
  // row (spec 379's REQ-1/REQ-4). The button sits in the name box now
  // and the badge has a column to itself, so the alignment is the
  // TABLE's: only the button keeps a width, since nothing in the name
  // box aligns it otherwise. What the browser draws is measured in
  // `test/e2e/specs-page-layout.test.ts`; this keeps the one remaining
  // width from quietly becoming a floor, which is what let the widest
  // row on the page govern the column before.
  test("the button carries an exact width, the badge takes its column's, and no row carries one", () => {
    expect(CSS).toMatch(/\.actionslot \{[^}]*[^-]width:\s*[\d.]+rem[^}]*\}/);
    expect(CSS).not.toMatch(/\.badgeslot \{[^}]*[^-]width:\s*[\d.]+rem[^}]*\}/);
    expect(CSS.match(/\n\.row \{([^}]*)\}/)?.[1] ?? "").not.toContain("width");
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

  test(".specsearch > .btn.primary carries the auto margin", () => {
    expect(CSS).toMatch(/\.specsearch > \.btn\.primary \{[^}]*margin-left:\s*auto[^}]*\}/);
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

// The State column's own width and the badge-to-button gap (spec 379,
// REQ-1/REQ-2/REQ-3/REQ-4) used to be guarded here by matching this
// stylesheet's own text (`min-width` on the column, `space-between` on
// the row) — replaced by rendered-width measurements in a real browser
// instead (REQ-6/REQ-7), in `test/e2e/specs-page-layout.test.ts`.

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

// A criterion on the Checks tab sits BESIDE its box and wraps inside its
// own width. Without a flex basis of 0 the text's natural width is the
// basis; a long criterion is then wider than the line and the row's
// `flex-wrap` moves the whole text under the box (seen on spec 456's
// acceptance criteria, 2026-09-14).
test("a criterion's text takes the room beside its box and wraps inside it", () => {
  expect(CSS).toMatch(/\.check \.checktask \{[^}]*flex: 1 1 0;[^}]*min-width: 0;[^}]*\}/);
  // The row still wraps: the note under a criterion depends on it.
  expect(CSS).toMatch(/\.check \{[^}]*flex-wrap: wrap;[^}]*\}/);
});

// --- the waiting layer states where it sits (spec 516) ----------------------
//
// A modal dialog's centring is the browser's own default, and on a phone
// it came up low and to the right. The layer now says it itself, on the
// open state only, so a closed one is left as it was.

/** The bodies of every `@media` block, brace-matched. */
function mediaBlocks(css: string): string[] {
  const out: string[] = [];
  let at = css.indexOf("@media");
  while (at !== -1) {
    const open = css.indexOf("{", at);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(open + 1, i - 1));
    at = css.indexOf("@media", i);
  }
  return out;
}

describe("the waiting layer is placed by its own rule, not the browser's default", () => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const open = () => oneRule(stripped, (r) => r.selectors.trim() === "dialog.pageoverlay[open]").body;
  const base = () => oneRule(stripped, (r) => r.selectors.trim() === "dialog.pageoverlay").body;

  test("the open layer is fixed, inset 0, auto margin and fit-content sized (AC-1)", () => {
    const body = open();
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0\b/);
    expect(body).toMatch(/margin:\s*auto/);
    expect(body).toMatch(/width:\s*fit-content/);
    expect(body).toMatch(/height:\s*fit-content/);
  });

  test("the base rule places nothing, so a closed layer is not placed (AC-1)", () => {
    const body = base();
    for (const prop of ["position", "inset", "margin", "width", "height"]) {
      expect([prop, new RegExp(`(^|[;\\s])${prop}\\s*:`).test(body)]).toEqual([prop, false]);
    }
  });

  test("no media block restyles a dialog, so the installed app draws the same rule (AC-2)", () => {
    for (const block of mediaBlocks(stripped)) {
      expect(block).not.toMatch(/dialog|pageoverlay/);
    }
  });

  test("a tall layer is limited to the screen and scrolls inside itself (AC-4)", () => {
    const body = open();
    expect(body).toMatch(/box-sizing:\s*border-box/);
    expect(body).toMatch(/max-width:\s*calc\(100%\s*-/);
    expect(body).toMatch(/max-height:\s*calc\(100%\s*-/);
    expect(body).toMatch(/overflow:\s*auto/);
  });

  test("the grid, the backdrop and the note keep their rules (AC-5)", () => {
    expect(base()).toMatch(/display:\s*grid/);
    expect(base()).toMatch(/place-items:\s*center/);
    const backdrop = rules(stripped).find((r) => r.selectors.trim() === "dialog.pageoverlay::backdrop");
    expect(backdrop?.body).toMatch(/background:\s*var\(--backdrop\)/);
    const note = rules(stripped).find((r) => r.selectors.trim() === "dialog.pageoverlay > .overlaynote");
    expect(note?.body).toMatch(/max-width:\s*22rem/);
    expect(note?.body).toMatch(/text-align:\s*center/);
  });
});
