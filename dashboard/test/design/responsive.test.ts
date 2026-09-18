// Spec 155: the dashboard on a phone.
//
// The whole change is CSS plus three markup hooks, and `bun test` never
// parses or executes CSS — it can only prove that a rule's source text
// is in the stylesheet, and that the elements the rule selects on are
// in the rendered HTML. Both halves are needed: a `data-col` attribute
// with no rule hides nothing, and a rule selecting an attribute nobody
// writes hides nothing either. What no test here can say is whether the
// page actually looks right at 390px — that is the Manual testing note
// in 3-solution.md.
import { describe, expect, test } from "bun:test";
import { CSS } from "../../src/render/ui/css";
import {
  renderSpecsRows,
  type SpecsPageOptions,
  type SpecTarget,
} from "../../src/render";
import { stepResults } from "../../src/render/pages/job-page";

/** One `@media` block's own text, brace-matched rather than regex-guessed:
 *  it holds nested rules, so `[^}]*` would stop at the first one. Every
 *  claim below about "at phone width" (or, since spec 488, about one of
 *  the two narrower bands inside it) is a claim about THIS text — a rule
 *  that drifted out of the block would still be in `CSS` and would still
 *  apply at every width the block's own condition does not gate, which
 *  is the failure worth catching. */
function mediaBlock(css: string, opening: string): string {
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + opening.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at + opening.length, i);
  }
  throw new Error(`the media query starting "${opening}" is never closed`);
}

const NARROW = mediaBlock(CSS, "@media (max-width: 40rem) {");
// Spec 488: the two narrower bands the compact AI/model button's own
// toggle lives in now, below the outer 40rem block above.
const BELOW_600 = mediaBlock(CSS, "@media (max-width: 37.5rem) {");
const GROWING_BAND = mediaBlock(CSS, "@media (min-width: 27rem) and (max-width: 37.5rem) {");

const target = (specFolder: string): SpecTarget => ({ project: "aide", specFolder });

const rows = (filter?: SpecsPageOptions["filter"], extra: Partial<SpecsPageOptions> = {}) =>
  renderSpecsRows(
    [],
    { runnerAvailable: true, targets: [target("155-x")], filter, ...extra },
    Date.parse("2026-08-21T12:00:00Z"),
  );

// --- criterion 1: the two columns a phone does not need ---------------------

describe("Started and Cost fold away at phone width", () => {
  // Scoped to the PHASE lines since the mobile-spec-row handoff
  // (2026-08-24): the spec's own header line keeps its date and cost,
  // folded onto the second line beside the badge and the button. Time
  // no longer hides here (spec 480, AC-5) — the room the compact
  // button gives back goes to it — but Cost still does.
  test("the narrow-width block hides Cost on the phase lines, but not Time", () => {
    expect(NARROW).toMatch(/table\.list tr\.subrow \[data-col="cost"\]\s*\{\s*display:\s*none;?\s*\}/);
    // Matches EITHER a rule of its own or a selector list it shares with
    // another column ("started, cost { display: none }") — the shape
    // this rule had before spec 480, and the shape a regression back to
    // it would take.
    expect(NARROW).not.toMatch(
      /table\.list tr\.subrow \[data-col="started"\](?:\s*,[^{]*)?\s*\{[^}]*display:\s*none/,
    );
  });

  // Time and Cost went the way Created already had (2026-09-07): the
  // phone's spec line is the title, then the pips, the button and the
  // state. A reader there is checking what is happening and pressing the
  // one control; neither figure is part of either.
  test("the spec header drops its time and its cost too", () => {
    expect(NARROW).toContain('table.list tr.spechead [data-col="started"] { display: none; }');
    expect(NARROW).toContain('table.list tr.spechead [data-col="cost"] { display: none; }');
  });

  // Line 1 is the title alone; line 2 is the pips, the button and the
  // state, in that order. The pips live inside the name box — where a
  // desktop wants them — so both the cell and the box are dissolved to
  // let them reach the second line.
  // The chevron and the title share line 1. The title's width is the
  // row less the chevron, the gap AND a little slack: the exact sum
  // wraps, because one fractional pixel in the row's width is enough to
  // drop the title under the chevron.
  test("the head row is two lines: the title, then the state", () => {
    expect(NARROW).toContain("table.list tr.spechead > td:first-child { display: contents; }");
    expect(NARROW).toContain(".spec-name { display: contents; }");
    expect(NARROW).toContain("table.list tr.spechead .spec-name > .label { flex: 0 0 calc(100% - 40px); }");
    // Line 2 is the State cell as one item, taking the whole width: the
    // pips at its left, the badge in its second column. Order 3 keeps
    // the title after it on a line of its own.
    expect(NARROW).toMatch(/tr\.spechead > td\[data-col="state"\] \{ order: 3; flex: 0 0 100%; display: grid;/);
    // After all three, never beside them: equal orders keep document
    // order, and this line is written in the FIRST cell — at the
    // badge's own order it came before the badge and, taking the whole
    // width, pushed it onto a line of its own.
    expect(NARROW).toMatch(/tr\.spechead \.spec-title \{ order: 4; flex: 0 0 100%; \}/);
  });

  // The badge reserved the width of its longest label ("implementing
  // queued") so the button AFTER it started at the same x on every row.
  // Nothing comes after it any more — the order is button, pips, state
  // (2026-09-07) — and 144px held for a five-letter "ready" wrapped the
  // state onto a line of its own.
  test("the spec header's badge takes its own width", () => {
    expect(NARROW).toMatch(/table\.list tr\.spechead \.badgeslot \{ width: auto/);
    // The holder, never the pill: a width on the badge itself stretches
    // its coloured background.
    expect(NARROW).not.toMatch(/tr\.spechead \.badge \{/);
  });

  // Criterion 2. Three separate renderers write these two cells — the
  // head row, each phase line, and the caption line above them — and
  // hiding one set while another stays visible leaves the table with
  // two empty columns nothing lines up under.
  test("the head row's Started and Cost cells carry the hook", () => {
    const html = rows();
    expect(html).toContain('<td data-col="started">');
    expect(html).toContain('<td class="num" data-col="cost">');
  });

  test("the sortable headings carry it too", () => {
    const html = rows();
    expect(html).toMatch(/<th [^>]*data-col="started"/);
    expect(html).toMatch(/<th [^>]*data-col="cost"/);
  });

  test("an opened row's own phase lines carry it on every line", () => {
    const html = rows(
      { open: "aide/155-x" },
      { modelChoices: [{ name: "opus" }] },
    );
    const subrows = [...html.matchAll(/<tr class="subrow[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    // Four phase lines plus the caption line above them.
    expect(subrows.length).toBe(5);
    for (const row of subrows) {
      expect(row).toContain('data-col="started"');
      expect(row).toContain('data-col="cost"');
    }
  });
});

// --- spec 317, REQ-8: the Created column at phone width ---------------------
//
// A deliberate choice, not an oversight: the phone's spec-header line
// already carries fold, name, pips, badge, action, duration and cost —
// a phone reader there is oriented to STATE and HOW LONG, not WHEN it
// began. Created is dropped from that line rather than reflowed onto
// it, same treatment Started/Cost already get on the subrow.
describe("Created folds away on the spec header at phone width", () => {
  test("the narrow-width block hides the column on the spec header line", () => {
    expect(NARROW).toContain('table.list tr.spechead [data-col="created"] { display: none; }');
  });

  test("the head row's Created cell carries the hook", () => {
    const html = rows();
    expect(html).toContain('data-col="created"');
  });

  test("the Created cell never breaks its date across two lines", () => {
    const html = rows();
    expect(html).toContain('<td class="created-date" data-col="created">');
    expect(CSS).toContain(".created-date { white-space: nowrap; }");
  });
});

// --- the pips belong to the NAME at phone width -----------------------------
//
// On the desktop the pips are pushed to the end of a fixed-width name
// box, so every row's pips start at the same x and read as one column
// down the table. There is no such column at phone width — each row is
// its own block — and pushing them anyway put them against the right
// edge while the state and the button started at the left edge of the
// line below: "et kjempestort rom mellom de og pips".
// The desktop gives the table a hard 63rem — the six column widths add
// up to exactly that — and `display: block` at phone width does not
// touch a width. Every row was 1008px long inside a 450px screen, with a
// scrollbar over content that had nothing to the right of it.
describe("the list is as wide as the screen at phone width", () => {
  test("the desktop's 63rem is given back", () => {
    expect(NARROW).toContain("table.speclist { width: auto; }");
  });

  test("the desktop rule it overrides is still there", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    // The desktop width is the BOX's since 2026-09-09 (list.css,
    // `#jobrows .tablewrap`) — the table takes 100% of it, which is what
    // `width: auto` above gives back at phone width just the same.
    expect(desktop).toContain("table.speclist { width: 100%; box-sizing: border-box; table-layout: fixed; }");
  });
});

describe("the row's name at phone width", () => {
  // The button stood at the end of the name box from 2026-09-07 to
  // 2026-09-08, and each width had a rule for it. It rides the caption
  // line the fold opens now, so a head row has no action to place —
  // at any width — and both rules went with it.
  test("no rule places an action in the head row, at either width", () => {
    expect(CSS).not.toContain(".spec-name > .actionslot");
    expect(NARROW).not.toContain("tr.spechead .actionslot");
  });

  // The title's width is the head row's own rule (the row less the
  // chevron, the gap and a little slack) — it is the ONE rule for it.
  // A second, fixed 17rem sat here from an earlier round, dead: the
  // head-row rule is the more specific of the two and every .spec-name
  // on this page is inside a head row.
  test("one rule sets the title's width, and it is the head row's", () => {
    expect(NARROW).toContain(".spec-name > .label { flex: 0 0 calc(100% - 40px); }");
    expect((NARROW.match(/\.spec-name > \.label \{/g) ?? []).length).toBe(1);
  });

  // The name box holds the fold and the name, and that is what these
  // rules select on. The pips are in the State cell (a phone's second
  // line, see phone-pips-beside-state.test.ts), never in the name box.
  test("the name box holds the name alone", () => {
    expect(rows()).not.toMatch(/<div class="spec-name">(?:(?!<\/div>)[\s\S])*pipslot/);
    expect(rows()).not.toContain("actionslot");
  });
});

// --- criterion 3: the open row's phase lines stack --------------------------

describe("the phase lines stop being pinned columns at phone width", () => {

  // Since the mobile-spec-row handoff (2026-08-24) a phase line is a
  // FLEX line at this width — identically whether its fold is open or
  // shut, because a table computes one column layout from all its rows,
  // and rows disagreeing about their display type scattered controls
  // into other rows' columns (the first attempt's bug). The two cells
  // dissolve: .modelcell and its .row become display:contents, so the
  // tick box and the .aimodel pair are flex items of the row itself,
  // and only .aimodel's own visibility follows the checkbox. Spec 488:
  // that dissolving is now scoped to the 37.5rem (600px) band, not the
  // whole 40rem (640px) one — above 600px the two selects stand as they
  // always have, see "the compact button grows..." below.
  test("every phase line is one flex row, open or shut", () => {
    expect(NARROW).toMatch(/table\.list tr\.subrow \{ display: flex;/);
    expect(BELOW_600.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .modelcell, table.list tr.subrow .modelcell > .row " +
        "{ display: contents; }",
    );
  });

  // Two selects side by side need more width than a 360px phone has, so
  // a narrow screen draws ONE box saying what the line is on and lays
  // the pair over it when tapped. Nothing is hidden behind a chevron —
  // that control is gone — and nothing is a second copy: the same two
  // selects are drawn once, for both widths. Spec 488: this box's own
  // rules live in the 600px band now, not the whole 640px one.
  test("the pair is one box on a narrow screen, and a panel over it", () => {
    expect(BELOW_600).toContain("table.list tr.subrow .aimodel { display: block; flex: 0 0 var(--aimodel-w); }");
    expect(BELOW_600).toContain("table.list tr.subrow .aimodelnow { width: var(--aimodel-w);");
    expect(BELOW_600).toContain("table.list tr.subrow .aimodel:has(.aimodelopen:checked) .aimodelpanel { display: flex; }");
    expect(BELOW_600).not.toContain("foldphase");
  });

  // Over the box, not under it: the panel is placed on the box's own
  // corner, so it covers what was tapped instead of pushing the phase
  // lines below it down the page.
  test("the panel lies on top of the box it opens from", () => {
    expect(BELOW_600).toMatch(/\.aimodelpanel \{[^}]*position: absolute;[^}]*top: 0; left: 0;/);
  });

  test("each select in the panel is under a word of its own", () => {
    expect(BELOW_600).toContain("table.list tr.subrow .aimodelfield { display: flex; flex-direction: column;");
    expect(BELOW_600).toContain("table.list tr.subrow .aimodelfield > span { display: block;");
    const html = rows({ open: "aide/155-x" }, { modelChoices: [{ name: "opus" }] });
    expect(html).toContain('<label class="aimodelfield"><span>AI</span>');
    expect(html).toContain('<label class="aimodelfield"><span>Model</span>');
  });

  // The box says what THIS line is on, never a fixed word: the model
  // the select is actually set to, bare, with no tool prefix — nothing
  // configured shares "opus" here (AC-1, spec 480). Spec 488: the label
  // now carries two spans (the bare SHORT text and the always
  // tool-prefixed FULL one), so this checks the short one specifically.
  test("the box names the line's own model", () => {
    const html = rows(
      { open: "aide/155-x" },
      { modelChoices: [{ name: "opus" }, { name: "codex-luna",  tool: "codex" }] },
    );
    expect(html).toContain('<span class="aimodelshort">opus</span>');
  });

  // A wide screen draws the two selects exactly as it always has: the
  // box is not drawn, and the panel is not a box.
  test("the desktop draws no box and no panel", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain(".aimodelopen, .aimodelnow { display: none; }");
    expect(desktop).toContain(".aimodelpanel, .aimodelfield { display: contents; }");
    expect(desktop).toContain(".aimodelfield > span { display: none; }");
  });

  // Free space at the end of the line is not a spacing: an auto margin
  // there put the width of whatever the status text left between the
  // status and the pair.
  // 12px of table-cell padding, added outside the 4.7rem the cell is
  // given (content-box), sat between the phase's name and the tick box.
  test("the phase name's cell gives its right padding back", () => {
    expect(NARROW).toContain(".phasecell { flex: 0 0 var(--phase-w); min-width: var(--phase-w); padding-right: 0; }");
    // Wide enough for the longest phase name in either language:
    // "implementering" is 98px in this face. An English page takes the
    // name column down to what "Implement" needs. --aimodel-w is now
    // three-tiered (spec 488): this outer block's own value is the
    // 600-640px band's, narrowed again by the two `@media` blocks at the
    // end of the file for the two bands below it (see next describe).
    expect(NARROW).toMatch(
      /table\.list \{ --phase-w: 5\.75rem; --aimodel-w: [0-9.]+rem; --tick-w: 31px; --time-w: [0-9.]+rem;/,
    );
    expect(NARROW).toContain('html[lang="en"] table.list { --phase-w: 4.5rem; }');
    // The left one stays — it is the indent under the spec's own name.
    expect(NARROW).not.toContain("table.list tr.subrow .phasecell { padding-left");
  });

  // AC-5, Round 2: the state cell's own width is fixed too, on an
  // ORDINARY phase line, so Time's already-fixed left edge (above)
  // starts at the same x whatever that phase's own state is — a run
  // phase's badge, or a not-yet-run phase's bare dash (which carries no
  // `.badge` at all, so a rule scoped to the badge alone would miss it).
  test("the phase line's own state cell is a fixed width, badge or dash alike", () => {
    expect(NARROW).toContain(
      'table.list tr.subrow[data-step] td[data-col="state"] {\n    flex: 0 0 var(--state-w); width: var(--state-w); min-width: 0;',
    );
    // The badge inside it still gives way with an ellipsis, not a hard
    // clip with no indicator — its full text stays reachable via title
    // (cell-helpers.ts).
    expect(NARROW).toContain(
      'table.list tr.subrow[data-step] td[data-col="state"] .badge {\n    max-width: 100%; overflow: hidden; text-overflow: ellipsis;',
    );
  });

  test("no rule is drawn under a phase line", () => {
    expect(NARROW).toContain("table.list tr.subrow { border-bottom: none; }");
    expect(NARROW).not.toContain("table.list tr.subrow { border-bottom: 1px");
  });

  test("the box follows the status, and is not pushed to the line's end", () => {
    expect(BELOW_600).not.toMatch(/tr\.subrow \.aimodel \{[^}]*margin-left: auto/);
  });

  // Inside the panel each select has the panel's own width, not a
  // width of its own: the panel is the box that was sized.
  test("the selects fill the panel", () => {
    expect(BELOW_600).toContain("table.list tr.subrow .aimodelpanel select { width: 100%;");
  });

  // Stated in the file, so the next person changing a width here knows
  // which number the widths are chosen against.
  test("the block says which screen it is drawn for", () => {
    expect(CSS).toContain("The narrowest screen this block is drawn for is 360px");
  });

  // 6.25rem of floor inside a screen that is 23rem wide. Held here, the
  // table would scroll — which is the whole of what this block exists to
  // prevent. Both caps fall together (min AND max): the model select's
  // 100px max-width outweighed the .aimodel > * rule by selector
  // specificity, so lifting only the minimum left a 90/10 split where
  // 50/50 was asked for.
  test("the width the phase lines reserve on a desktop is given back", () => {
    expect(NARROW).not.toContain("toolcell");
    expect(BELOW_600).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; max-width: none; }',
    );
  });

  // The desktop rule must survive verbatim: the override wins by
  // coming later in the cascade, not by replacing it, and
  // design-system.test.ts asserts on the original.
  test("the desktop rule is still declared outside the media query", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain("table.list tr.subrow .modelcell > .row { flex-wrap: nowrap; }");
  });
});

// --- spec 488: the AI/Model button grows between 400px and 600px -----------

describe("the compact button grows with the width (spec 488)", () => {
  // AC-6: below 400px the button still shows one span's worth of text,
  // exactly as before spec 488 — the bare model name, never the
  // tool-prefixed form.
  test("below 400px the button still shows the short text, and hides the full one", () => {
    expect(BELOW_600).toContain("table.list { --aimodel-w: 3.875rem; }");
    expect(BELOW_600).toMatch(/\.aimodelfull \{ display: none; \}/);
  });

  // AC-1/AC-2: the 400-600px band widens the button and shows the
  // tool-prefixed FULL text instead of the bare one.
  test("400-600px widens the button and shows the tool-prefixed text", () => {
    expect(GROWING_BAND).toMatch(/table\.list \{ --aimodel-w: [0-9.]+rem; \}/);
    expect(GROWING_BAND).toContain("table.list tr.subrow .aimodelshort { display: none; }");
    expect(GROWING_BAND).toContain("table.list tr.subrow .aimodelfull { display: block; }");
    // Wider than the sub-400px default, or there is nothing to grow into.
    const belowWidth = Number(/--aimodel-w: ([0-9.]+)rem/.exec(BELOW_600)![1]);
    const growingWidth = Number(/--aimodel-w: ([0-9.]+)rem/.exec(GROWING_BAND)![1]);
    expect(growingWidth).toBeGreaterThan(belowWidth);
  });

  // Both candidate spans carry their own ellipsis fallback (plan-review
  // finding, 3-solution.md): the parent's own overflow:hidden does not
  // reliably clip a block-level child's text, only a direct text node.
  test("each candidate span clips its own overflow", () => {
    expect(BELOW_600).toMatch(
      /table\.list tr\.subrow \.aimodelshort,\s*table\.list tr\.subrow \.aimodelfull \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;[^}]*min-width: 0;/,
    );
  });

  // AC-3: from 600 to 640px the button/panel toggle, the caption's
  // AI/Model merge and the selects' own width un-cap all stop applying —
  // list.css's own unconditional rules are what is left standing, the
  // same ones a screen above 640px already relies on.
  test("the button/panel toggle and the caption merge live only below 600px", () => {
    expect(BELOW_600).toContain("table.list tr.subrow .aimodel { display: block; flex: 0 0 var(--aimodel-w); }");
    expect(BELOW_600).toMatch(/\[data-cap="ai"\]::after \{ content: "\/Model"; \}/);
    expect(BELOW_600).toMatch(/\[data-cap="model"\] \{ display: none; \}/);
    // Neither rule reaches the outer 40rem block on its own any more —
    // only the narrower 37.5rem one, captured separately above.
    expect(NARROW).not.toContain("table.list tr.subrow .aimodel { display: block;");
  });

  // [data-cap="model"] needs the same `order` as [data-cap="ai"] beside
  // it (a flex `order` tie falls back to DOM order, which already reads
  // ai-then-model) or, the moment it stops being hidden at 600px, it
  // would sort ahead of the whole caption line instead of between AI and
  // the tick's own "Select" caption.
  test("the model caption is ready to take its place in the caption line's order", () => {
    expect(NARROW).toContain(
      'table.list tr.subrow[data-caption="1"] .modelcell > .row > [data-cap="model"] { order: 4; }',
    );
  });
});

// --- criterion 4, 7, 8: a wide table scrolls, the page does not -------------

describe("every wide table scrolls inside its own box", () => {
  // Spec 255: the settings form's own `.project-settings-editor`
  // wrapper (and its narrow-only overrides) is gone with the `<details>`
  // it used to scope. Save/Cancel and the settings table now each sit
  // in a bare `.newspecform .frow`, whose `flex-basis: 100%` already
  // stacks them full-width at every screen size — a stronger guarantee
  // than a narrow-only wrap, not a narrower one.
  test("the inline project settings form's rows each take their own full-width line", () => {
    // The selector picks up a comma-joined sibling now (spec 277's
    // `.scheduledeleteform .frow`, reusing this same rule) — matched up
    // to the `{`, not immediately after `.frow`, so a second selector
    // sharing the rule does not itself break this assertion.
    expect(CSS).toMatch(/\.newspecform \.frow[^{]*\{[^}]*flex-basis:\s*100%/);
  });

  test(".tablewrap is a scroll box at every width, like .specfile", () => {
    expect(CSS).toMatch(/\.tablewrap \{[^}]*overflow-x:\s*auto/);
    // Unconditional: a table three columns wider than the window is not
    // a phone-only problem, and .specfile does not gate it either. A
    // vertical-scroll override for #jobrows now legitimately exists in
    // the narrow block (spec 320, REQ-4), so this checks only that no
    // narrow rule touching .tablewrap sets overflow-x — the horizontal
    // guarantee, not the class name's mere presence.
    expect(NARROW).not.toMatch(/\.tablewrap[^{]*\{[^}]*overflow-x/);
  });

  test("the spec list's table is wrapped", () => {
    expect(rows()).toContain('<div class="tablewrap"><table class="list speclist">');
  });

  // Spec 226. The cap that kept this list short is gone, so the list is
  // as long as the archive is; it scrolls in a box of its own, and the
  // controls above it stay where the reader left them.
  //
  // Scoped to `#jobrows`, not to `.tablewrap` at large: the job page's
  // Steps table and the settings table wear the same class and nobody
  // asked for either of them to be bounded in height.
  describe("the spec list scrolls in its own box (spec 226)", () => {
    /** The `#jobrows .tablewrap` rule's body. */
    const listWrap = (): string => {
      const m = /#jobrows \.tablewrap \{([^}]*)\}/.exec(CSS);
      expect(m).not.toBeNull();
      return m![1]!;
    };

    test("the list's box has a height to scroll inside (criterion 2)", () => {
      expect(listWrap()).toMatch(/overflow-y:\s*auto/);
      expect(listWrap()).toMatch(/flex:\s*1/);
      expect(listWrap()).toMatch(/min-height:\s*0/);
    });

    // The page still scrolls the ordinary way everywhere else — the
    // BARE main/body rules (checked below, "the bare body/main rules
    // stay ordinary") carry no cap; spec 320 adds one, but only on a
    // rule scoped to this one page (`body:has(#jobrows)`), never on
    // the unscoped rules this assertion reads.
    test("nothing else on the page is bounded to make it work", () => {
      expect(CSS).not.toMatch(/\bmain \{[^}]*overflow/);
      expect(CSS).not.toMatch(/\bbody \{[^}]*overflow/);
    });

    // The middle link in the chain (spec 320): #jobrows itself has to
    // be a flex column, or .tablewrap has nothing to grow into.
    test("#jobrows is the flex column .tablewrap grows inside", () => {
      const m = /#jobrows \{([^}]*)\}/.exec(CSS);
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(/display:\s*flex/);
      expect(m![1]).toMatch(/flex-direction:\s*column/);
      expect(m![1]).toMatch(/min-height:\s*0/);
    });

    // Spec 320: the fixed 70vh guess is gone, replaced by a scoped
    // body/main chain that hands the list whatever space is actually
    // left over. Scoped with :has(#jobrows) — the id only this page
    // ever writes — so no other page's body/main is touched (REQ-5).
    test("body/main are capped to the viewport on this page only", () => {
      const body = /body:has\(#jobrows\) \{([^}]*)\}/.exec(CSS);
      expect(body).not.toBeNull();
      expect(body![1]).toMatch(/height:\s*100vh/);
      expect(body![1]).toMatch(/overflow:\s*hidden/);

      const main = /body:has\(#jobrows\) main \{([^}]*)\}/.exec(CSS);
      expect(main).not.toBeNull();
      expect(main![1]).toMatch(/flex:\s*1/);
      expect(main![1]).toMatch(/min-height:\s*0/);
      // Risk 2's mitigation: overflow stays off this scoped `main`
      // rule, or a dropdown opening near the bottom edge gets clipped.
      expect(main![1]).not.toMatch(/overflow/);
    });

    // REQ-5, checked directly rather than only by the scoped rules
    // above existing: the BARE (unscoped) body/main rules must carry
    // none of this page's cap. A regex on the word "height" alone
    // would trip on page.css's own pre-existing `min-height: 100vh`
    // on body and on the new scoped `main` rule's `min-height: 0`, so
    // this excludes anything immediately preceded by the :has() scope.
    test("the bare body/main rules stay ordinary (REQ-5)", () => {
      const bareBody = /(?<!:has\([^)]*\)\s)\bbody \{([^}]*)\}/.exec(CSS);
      expect(bareBody).not.toBeNull();
      expect(bareBody![1]).not.toMatch(/overflow:\s*hidden/);
      expect(bareBody![1]).not.toMatch(/(?<!min-)height:\s*100vh/);

      const bareMain = /(?<!:has\([^)]*\)\s)\bmain \{([^}]*)\}/.exec(CSS);
      expect(bareMain).not.toBeNull();
      expect(bareMain![1]).not.toMatch(/display:\s*flex/);
      expect(bareMain![1]).not.toMatch(/overflow:\s*hidden/);
    });

    // At phone width too the box stays: the header, the tabs and the
    // filter row keep their place and only the rows scroll, as they do
    // held sideways and on a desktop (2026-09-18, reversing spec 320's
    // REQ-4, which let the whole page scroll on a phone).
    test("the narrow-width block keeps the box, so the top of the page stays put on a phone", () => {
      expect(NARROW).not.toMatch(/#jobrows \.tablewrap \{[^}]*overflow-y:\s*visible/);
      expect(NARROW).not.toMatch(/body:has\(#jobrows\) \{[^}]*display:\s*block/);
      expect(NARROW).not.toMatch(/body:has\(#jobrows\) \{[^}]*overflow:\s*visible/);
    });

    // Criterion 2's other half: the chips, the "?", New spec and the
    // search field are OUTSIDE the box, ahead of it in the markup. That
    // is the structural fact a string test can check; that they visibly
    // stay put while the rows move is the Manual testing note.
    test("every control sits ahead of the box, not inside it (criterion 2)", () => {
      const html = rows();
      const box = html.indexOf('<div class="tablewrap">');
      expect(box).toBeGreaterThan(-1);
      const above = html.slice(0, box);
      for (const control of ['data-filter="state"', '<details class="intro">', 'class="specsearch"'])
        expect(above).toContain(control);
      expect(html.slice(box)).not.toContain("specsearch");
    });
  });

  test("the Steps table on the job and spec pages is wrapped", () => {
    const html = stepResults([
      {
        step: "analyze",
        ok: true,
        costUsd: 1.5,
        costMeasured: true,
        terminalReason: "done",
        at: "2026-08-21T10:00:00Z",
      },
    ]);
    expect(html).toContain('<div class="tablewrap"><table>');
    expect(html.endsWith("</table></div>")).toBe(true);
  });

  // A generated page per project carried a spec table and it was
  // wrapped here. Both went on 2026-08-22: the server serves the one
  // project page there is, and the spec list is the Specs tab.
});

// --- criterion 5: two fields side by side become two lines ------------------

describe("the form rows wrap at phone width", () => {
  test("the narrow-width block lets .frow wrap", () => {
    expect(NARROW).toMatch(/\.frow \{[^}]*flex-wrap:\s*wrap/);
  });
});

// --- spec 263: the search row no longer wraps the field onto its own line ---

describe("the search row stays on one line at phone width", () => {
  // Criterion 1: the field's desktop 26rem clamps to the row's full width
  // under 40rem, and flex-wrap: wrap is what then pushes Search and New
  // spec onto a line of their own — the narrow block has to override both
  // the wrap and the width for the three controls to share one line.
  test("the row stops wrapping and the field gets a narrow resting width", () => {
    expect(NARROW).toMatch(/\.specsearch \{[^}]*flex-wrap:\s*nowrap/);
    const m = /\.searchfield \{[^}]*width:\s*([\d.]+)rem/.exec(NARROW);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(26);
  });

  // Criterion 2, first half: focusing the field lets it grow again.
  test("the field grows when its input has focus", () => {
    expect(NARROW).toMatch(/\.searchfield:focus-within \{[^}]*flex(-grow)?:\s*1/);
  });

  // Criterion 2, second half: only New spec (`.btn.primary`) may hide on
  // focus — Search is a plain `.btn` and this selector must not reach it.
  test("New spec hides while the field is focused, Search never does", () => {
    expect(NARROW).toContain(
      ".specsearch:has(.searchfield:focus-within) .btn.primary { display: none; }",
    );
    expect(NARROW).not.toMatch(/\.searchfield:focus-within[^}]*\}\s*\.btn\s*\{[^}]*display:\s*none/);
  });

  // Criterion 3: blurring the field has no CSS event of its own — what
  // proves the return to the resting state is the desktop rule surviving
  // OUTSIDE the narrow block, combined with the focus-within test above
  // (the override only applies while :focus-within matches).
  test("the desktop width rule survives outside the narrow block", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain("width: 26rem; max-width: 100%");
  });
});

// --- spec 460: New no longer wraps onto its own line between 40rem and
// the row's own full-width point -------------------------------------

describe("the search row also stays on one line above phone width", () => {
  // AC-1/AC-2: above the 40rem phone step, the row must still not wrap,
  // and the field — not Search, "?", State or New — is what gives up
  // the room. Scoped to #jobrows via :where() so it never reaches
  // /schedule's own copy of this row and never outranks the phone
  // step's own bare `.searchfield` rule by specificity.
  test("the desktop CSS keeps the row on one line and lets the field shrink", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toMatch(/:where\(#jobrows\) \.specsearch \{[^}]*flex-wrap:\s*nowrap/);
    expect(desktop).toMatch(
      /:where\(#jobrows\) \.searchfield \{[^}]*flex:\s*1 1[^}]*max-width:\s*26rem/,
    );
  });

  // AC-3: the phone step's own resting width (7rem) must not grow just
  // because the new desktop-side rule now sets a floor of its own —
  // the phone block needs its own reset back to 0.
  test("the phone step resets the new min-width floor", () => {
    expect(NARROW).toContain(".searchfield { width: 7rem; flex: 0 1 7rem; min-width: 0; }");
  });
});

// Spec 325: on the Specs page, `body:has(#jobrows)` (spec 320) makes
// `body` a flex column, and a flex item whose cross-axis margins are
// both `auto` is never stretched to the container's width — it shrinks
// to its own content instead. `header`, the tab bar and `main` need an
// explicit, content-independent width to stay equal there, not just on
// every other page where block layout already gave them one for free.
describe("the frame keeps one width, and the tabs sit in the middle of it", () => {
  /** The shared frame rule's own body. */
  const frameRule = (): string => {
    const m = /header, body > nav\.tabbar, main, body > p\.rowmsg \{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    return m![1]!;
  };

  test("header, the tab bar and main share an explicit, content-independent width (REQ-1, REQ-5)", () => {
    expect(frameRule()).toMatch(/width:\s*100%/);
    expect(frameRule()).toMatch(/box-sizing:\s*border-box/);
    expect(frameRule()).toMatch(/max-width:\s*calc\(72rem \+ 2 \* var\(--sp-6\)\)/);
  });

  test("the frame stays centred (REQ-2)", () => {
    expect(frameRule()).toMatch(/margin-inline:\s*auto/);
  });

  test("the top-level tab bar centres its tabs as a rule of its own (REQ-3)", () => {
    const m = /body > nav\.tabbar \{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/justify-content:\s*center/);
  });

  // Guard: the inner (spec/job) tab row shares the `.tabbar` class but
  // is a different selector entirely and must not pick up the same
  // centring — it takes the page's width, not the frame's.
  test("the inner subtabs row is not centred by the same rule", () => {
    const m = /nav\.tabbar\.subtabs \{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/justify-content:\s*center/);
  });
});

// --- the States trigger's own margin from the "(?)" popover (spec 338) -----

describe("the States trigger sits further from the (?) popover than the row's own gap", () => {
  test("the desktop rule gives .menu.state its own margin (REQ-7)", () => {
    expect(CSS).toContain(".menu.state { margin-left: var(--sp-3); }");
    // The rest of the row's spacing is untouched: the flex gap itself
    // still carries every other pair of controls apart.
    expect(CSS).toContain(
      ".specsearch { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2);",
    );
  });

  test("the narrow block undoes it, so the phone layout is unchanged (REQ-8)", () => {
    expect(NARROW).toContain(".menu.state { margin-left: 0; }");
  });
});

// --- the Depends on field scrolls instead of pushing the form down
// (spec 357) -----------------------------------------------------------
//
// `.phases` is `phases()`'s one class (components.ts), and `phases()`
// has one caller, `dependsOnField()` — shared by the New-spec page and
// the spec page's Description tab (spec 174). One rule on `.phases`
// therefore reaches both without a second copy.

// --- spec 436: theme/language/unit collapse into the … menu at phone width -

describe("header menus collapse into the … menu at phone width (spec 436)", () => {
  test("AC-2 criterion 3: the narrow-width block hides the three standalone triggers", () => {
    expect(NARROW).toContain(".menu.theme, .menu.lang, .menu.unit { display: none; }");
  });

  test("AC-2 criterion 4: the narrow-width block reveals the morerows block", () => {
    expect(NARROW).toContain(".menu .morerows { display: flex; flex-direction: column; gap: 2px; }");
  });

  test("the desktop CSS keeps morerows hidden by default", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain(".menu .morerows { display: none; }");
  });

  test("the desktop CSS styles label rows the same as the button/link rows beside them", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toMatch(/\.menupanel > label, \.menu \.morerows > label \{/);
  });
});

describe("the Depends on field caps its height and scrolls its own overflow", () => {
  test(".phases is capped to about four lines of chips and scrolls (REQ-1, REQ-2)", () => {
    const rule = /\.phases \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toMatch(/max-height:\s*[\d.]+(px|rem)/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  test("the cap lives in one rule, not two, so both pages share it (REQ-4)", () => {
    expect((CSS.match(/\.phases \{/g) ?? []).length).toBe(1);
  });

  test("no narrow-width override touches it, so the phone layout is unchanged (REQ-6)", () => {
    expect(NARROW).not.toContain(".phases");
  });
});

// Spec 474: the New-spec page's own Depends-on field, side by side.
describe("spec 474: the New-spec page's Depends-on columns sit side by side, framed alike", () => {
  test("AC-1: .field.depends-pair lays its two columns out as a row", () => {
    const rule = /\.field\.depends-pair \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toMatch(/flex-direction:\s*row/);
  });

  test("AC-3: the picked column matches the pick list's own framed look", () => {
    const picked = /\.depends-pair \.phases\.picked \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    const rest = /\.phases:not\(\.picked\) \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    for (const prop of ["border", "background", "height", "padding", "box-sizing"]) {
      const value = (block: string) => new RegExp(`${prop}:\\s*([^;]+);`).exec(block)?.[1];
      expect(value(picked)).toBe(value(rest));
    }
  });

  test("the narrow-width block collapses the two columns to one", () => {
    expect(NARROW).toMatch(/\.depends-pair \{[^}]*flex-direction:\s*column/);
  });
});
