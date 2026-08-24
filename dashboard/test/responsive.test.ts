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
  test("the narrow-width block hides both columns in the header and the phase lines", () => {
    expect(NARROW.replace(/\s+/g, " ")).toContain(
      'table.list thead [data-col="started"], table.list thead [data-col="cost"], ' +
        'table.list tr.subrow [data-col="started"], table.list tr.subrow [data-col="cost"] ' +
        "{ display: none; }",
    );
  });

  // Spec 215: the spec header's own Started/Cost cells stack with the
  // name now, rather than vanishing — a bare, unscoped selector would
  // hide them again.
  test("the spec header's own Started and Cost cells are not named by the hide rule", () => {
    expect(NARROW).not.toMatch(/table\.list \[data-col="started"\]/);
    expect(NARROW).not.toMatch(/table\.list \[data-col="cost"\]/);
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

// --- criteria 1, 3: the spec header shrinks and stacks instead of scrolling -

describe("the spec header stacks at phone width instead of scrolling (spec 215)", () => {
  test(".spec-name is declared once, with a width that can shrink to fit", () => {
    expect((CSS.match(/\.spec-name\s*\{/g) ?? []).length).toBe(1);
    expect(CSS).toMatch(/\.spec-name\s*\{[^}]*width:\s*min\(27rem,\s*100%\)/);
    expect(CSS).not.toMatch(/\.spec-name\s*\{[^}]*width:\s*27rem/);
  });

  test("the narrow-width block makes every spechead cell a full-width block", () => {
    expect(NARROW.replace(/\s+/g, " ")).toContain(
      "table.list tr.spechead > td { display: block; width: 100%; }",
    );
  });

  test("the head row still renders its badge, date and cost — nothing removed, only restyled", () => {
    const html = rows();
    const head = html.match(/<tr class="spechead[^"]*"[^>]*>[\s\S]*?<\/tr>/)![0];
    expect(head).toContain('<td data-col="started">');
    expect(head).toContain('<td class="num" data-col="cost">');
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
  // 192 there are TWO of them — the name, then the one cell that holds
  // the AI select, the model select and the phase's box together. Two
  // selects and a name do not cross 375px, so each cell takes a line of
  // its own, and the row inside the merged cell wraps as it already
  // did — over three children now instead of two, which is the whole
  // of what the merge asked of this block.
  test("the merged cell's controls wrap onto a line each", () => {
    expect(NARROW).toContain("table.list tr.subrow .modelcell > .row { flex-wrap: wrap; }");
  });

  // Spec 215: a third cell, the status word, joins the same stacked
  // group — a collapsed phase now reads as one unbroken block instead
  // of two cells stacking together while the status sits in a column
  // of its own to their right.
  test("a phase line's three cells each take a line of their own", () => {
    expect(NARROW.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .phasecell, table.list tr.subrow .modelcell, " +
        "table.list tr.subrow .phaseword { display: block; width: 100%; }",
    );
  });

  // 6.25rem of floor inside a screen that is 23rem wide. Held here, the
  // table would scroll — which is the whole of what this block exists to
  // prevent. The stacking rule above needs it released just as badly: a
  // full-width block still honours a min-width. The AI column's own 8rem
  // went with the column in spec 192, so there is one width left to give
  // back rather than two.
  test("the width the phase lines reserve on a desktop is given back", () => {
    expect(NARROW).not.toContain("toolcell");
    expect(NARROW).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; }',
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

// --- criteria 6, 7, 9: analyze/implement fold their AI/model at phone width -

describe("analyze and implement fold their AI and model controls at phone width (spec 215)", () => {
  const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));

  test("an open fold's controls sit side by side, and a closed fold is forced open outside the narrow block", () => {
    expect(desktop).toContain("details.phasedetail > .row { flex-wrap: nowrap; }");
    expect(desktop).toContain("details.phasedetail:not([open]) > .row { display: flex; }");
  });

  test("the same selector is reversed inside the narrow block, so only there does the fold actually close", () => {
    expect(NARROW).toContain("details.phasedetail:not([open]) > .row { display: none; }");
  });

  test("the chevron is hidden outside the narrow block and shown inside it", () => {
    expect(desktop).toMatch(/summary\.fold\s*\{[^}]*display:\s*none/);
    expect(NARROW).toMatch(/summary\.fold\s*\{[^}]*display:\s*inline-flex/);
  });

  test("archive's AI and model selects are hidden at phone width, and no other step has an equivalent rule", () => {
    expect(NARROW).toContain('[data-step="archive"] .modelcell select { display: none; }');
    expect(NARROW.match(/\.modelcell select \{ display: none; \}/g) ?? []).toHaveLength(1);
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
