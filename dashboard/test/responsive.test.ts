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
import { CSS } from "../src/render/css.ts";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueTarget,
} from "../src/render.ts";
import { stepResults } from "../src/render/job-page.ts";

/** The one narrow-width block, brace-matched rather than regex-guessed:
 *  it holds nested rules, so `[^}]*` would stop at the first one. Every
 *  claim below about "at phone width" is a claim about THIS text — a
 *  rule that drifted out of the block would still be in `CSS` and would
 *  still apply at every width, which is the failure worth catching. */
function narrowBlock(css: string): string {
  const opening = "@media (max-width: 40rem) {";
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + opening.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at + opening.length, i);
  }
  throw new Error("the narrow-width media query is never closed");
}

const NARROW = narrowBlock(CSS);

const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

const rows = (filter?: QueuePageOptions["filter"], extra: Partial<QueuePageOptions> = {}) =>
  renderQueueRows(
    [],
    { runnerAvailable: true, targets: [target("155-x")], filter, ...extra },
    Date.parse("2026-08-21T12:00:00Z"),
  );

// --- criterion 1: the two columns a phone does not need ---------------------

describe("Started and Cost fold away at phone width", () => {
  // Scoped to the PHASE lines since the mobile-spec-row handoff
  // (2026-08-24): the spec's own header line keeps its date and cost,
  // folded onto the second line beside the badge and the button.
  test("the narrow-width block hides both columns on the phase lines", () => {
    expect(NARROW).toMatch(
      /table\.list tr\.subrow \[data-col="started"\][\s\S]*?tr\.subrow \[data-col="cost"\][\s\S]*?display:\s*none/,
    );
  });

  test("the spec header keeps its date, shown as an ordinary flex item", () => {
    expect(NARROW).toContain('table.list tr.spechead [data-col="started"] { display: block; }');
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
      { modelChoices: [{ name: "opus", budgetUsd: 10 }] },
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

// --- criterion 3: the open row's phase lines stack --------------------------

describe("the phase lines stop being pinned columns at phone width", () => {
  // The stack's cell gave up a fixed 14rem width here until spec 157
  // deleted the cell outright: a row draws one button now, in the
  // State column, and the phase lines lead their own rows. There is no
  // width left to release at this breakpoint.
  test("no stack cell is declared at any width", () => {
    expect(CSS).not.toContain("stackcell");
  });

  // Since the mobile-spec-row handoff (2026-08-24) a phase line is a
  // FLEX line at this width — identically whether its fold is open or
  // shut, because a table computes one column layout from all its rows,
  // and rows disagreeing about their display type scattered controls
  // into other rows' columns (the first attempt's bug). The two cells
  // dissolve: .modelcell and its .row become display:contents, so the
  // tick box and the .aimodel pair are flex items of the row itself,
  // and only .aimodel's own visibility follows the checkbox.
  test("every phase line is one flex row, open or shut", () => {
    expect(NARROW).toMatch(/table\.list tr\.subrow \{ display: flex;/);
    expect(NARROW.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .modelcell, table.list tr.subrow .modelcell > .row " +
        "{ display: contents; }",
    );
  });

  test("the AI/model pair hides until the phase's own fold is opened", () => {
    expect(NARROW).toContain("table.list tr.subrow .aimodel { display: none; }");
    expect(NARROW).toMatch(
      /tr\.subrow:has\(\.foldphase:checked\) \.aimodel \{\s*display: flex;/,
    );
  });

  // 6.25rem of floor inside a screen that is 23rem wide. Held here, the
  // table would scroll — which is the whole of what this block exists to
  // prevent. Both caps fall together (min AND max): the model select's
  // 100px max-width outweighed the .aimodel > * rule by selector
  // specificity, so lifting only the minimum left a 90/10 split where
  // 50/50 was asked for.
  test("the width the phase lines reserve on a desktop is given back", () => {
    expect(NARROW).not.toContain("toolcell");
    expect(NARROW).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; max-width: none; }',
    );
  });

  test("no pinned flex children survive at any width", () => {
    expect(CSS).not.toContain(".phasecell > .row");
    expect(CSS).not.toMatch(/flex:\s*0 0 2\.5rem/);
    expect(CSS).not.toMatch(/flex:\s*0 0 6rem/);
  });

  // The desktop rule must survive verbatim: the override wins by
  // coming later in the cascade, not by replacing it, and
  // design-system.test.ts asserts on the original.
  test("the desktop rule is still declared outside the media query", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain("table.list tr.subrow .modelcell > .row { flex-wrap: nowrap; }");
  });
});

// --- criterion 4, 7, 8: a wide table scrolls, the page does not -------------

describe("every wide table scrolls inside its own box", () => {
  test(".tablewrap is a scroll box at every width, like .specfile", () => {
    expect(CSS).toMatch(/\.tablewrap \{[^}]*overflow-x:\s*auto/);
    // Unconditional: a table three columns wider than the window is not
    // a phone-only problem, and .specfile does not gate it either.
    expect(NARROW).not.toContain(".tablewrap");
  });

  test("the spec list's table is wrapped", () => {
    expect(rows()).toContain('<div class="tablewrap"><table class="list speclist">');
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
