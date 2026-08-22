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
  test("the narrow-width block hides both columns", () => {
    expect(NARROW).toMatch(
      /table\.list \[data-col="started"\][\s\S]*?\[data-col="cost"\][\s\S]*?display:\s*none/,
    );
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
    // Five phase lines plus the caption line above them.
    expect(subrows.length).toBe(6);
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

  // Since spec 165 a phase line is real table columns, and since spec
  // 179 there are three of them on EVERY line — the name, the AI
  // select, then the model with the phase's box beside it. Two selects
  // and a name do not cross 375px, so each cell takes a line of its
  // own, and the pair inside the model's cell wraps as it already did.
  test("the model and its box wrap inside their own cell", () => {
    expect(NARROW).toContain("table.list tr.subrow .modelcell > .row { flex-wrap: wrap; }");
  });

  test("a phase line's three cells each take a line of their own", () => {
    expect(NARROW.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .phasecell, table.list tr.subrow td.toolcell, " +
        "table.list tr.subrow .modelcell { display: block; width: 100%; }",
    );
  });

  // 8rem for the AI column and 6.25rem inside the model's is over 14rem
  // of floor, in a screen that is 23rem wide. Held here, the table would
  // scroll — which is the whole of what this block exists to prevent.
  // The stacking rule above needs them released just as badly: a
  // full-width block still honours a min-width.
  test("the widths the phase lines reserve on a desktop are given back", () => {
    expect(NARROW).toContain("table.list tr.subrow td.toolcell { min-width: 0; }");
    expect(NARROW).toContain(
      "table.list tr.subrow .modelcell > .row > :first-child { min-width: 0; }",
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
    expect(rows()).toContain('<div class="tablewrap"><table class="list">');
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
