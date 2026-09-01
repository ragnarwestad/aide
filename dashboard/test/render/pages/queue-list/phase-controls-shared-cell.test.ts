// Split out of phase-controls-and-progress.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import {
  row,
  openKeys,
} from "../fixtures.ts";

// --- spec 192: the phase line's controls share one cell ---------------------
//
// Spec 165 made the phase lines REAL COLUMNS — the name, the phase's
// AI, then the model with the phase's box beside it. They had been
// three flex children of one cell until then, each pinned to a fixed
// width by hand so every select started at the same x, and a table
// column does that bookkeeping for free.
//
// It charges for it too. A column reserves a width of its own and
// carries its own cell padding, so three columns in a row is three
// reserved widths and two lots of padding between the name and the
// box — far enough apart that the three read as three separate things
// rather than as one line's worth of choice. Narrowing the model
// column's reserved width twice on 2026-08-22 closed part of the gap
// and left the column boundary itself standing, which is the half that
// mattered.
//
// So the AI select, the model select and the box share ONE cell now —
// the cell the model select and the box already shared — and the three
// captions share the caption row's. The name keeps a cell of its own,
// hard left, untouched. The column the merge vacates is the one the
// head row's own pips occupy, and it goes back to being empty on a
// phase line, exactly as it was before spec 165. Seven columns either
// way.
describe("spec 192: the phase line's controls share one cell", () => {
  const target = (specFolder = "192-one-cell"): QueueTarget => ({
    project: "aide",
    specFolder,
  });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  const ONE = [{ name: "sonnet", budgetUsd: 3 }];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<QueuePageOptions> = {},
    targets: QueueTarget[] = [target()],
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  /** Every cell of one row, in order — the content between one cell's
   *  opening tag and the next one's. */
  const cells = (tr: string): string[] =>
    tr
      .split(/<t[dh]\b[^>]*>/)
      .slice(1)
      .map((s) => s.replace(/<\/t[dh]>[\s\S]*$/, ""));
  /** One row's cell OPENING TAGS, in order: what a cell is, as opposed
   *  to what is in it. */
  const cellTags = (tr: string): string[] => [...tr.matchAll(/<t[dh]\b[^>]*>/g)].map((m) => m[0]);
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">[\\s\\S]*?</tr>`))?.[0] ?? "";
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRows = (html: string) => [
    ...html.matchAll(/<tr class="subrow[^"]*"[^>]*data-step="[^"]*">[\s\S]*?<\/tr>/g),
  ].map((m) => m[0]);

  // --- criterion 2: the name is what the eye lands on -----------------------

  test("the phase's name has its own cell, alone and hard left (criterion 2)", async () => {
    const html = rows();
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const first = cells(subRow(html, step))[0] ?? "";
      // The name, and no CONTROL in front of it: no phase box, no
      // placeholder span holding a column's place, no select. The
      // mobile fold control (2026-08-24) is the one deliberate
      // exception — its checkbox and chevron are invisible outside the
      // phone media query, so on a desktop the cell still reads as the
      // name alone.
      expect([step, first.includes("data-phase")]).toEqual([step, false]);
      expect([step, first.includes("<select")]).toEqual([step, false]);
      expect([step, first.includes('class="foldphase"')]).toEqual([step, true]);
      // The name is the whole of the visible text — a future
      // `STEP_LABELS` entry would reach a reader as a different word,
      // so the cell is checked for shape and not for the step's own
      // word.
      expect([
        step,
        /<(a|span)[^>]*>[a-z-]+<\/(a|span)><\/label>$/.test(first),
      ]).toEqual([step, true]);
      // And it is still a cell of its own: the merge is behind it, not
      // around it.
      expect([step, cellTags(subRow(html, step))[0]]).toEqual([step, '<td class="phasecell">']);
    }
    // And the indent that used to hold the box's place goes with it.
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).not.toContain("table.list tr.subrow .phasecell { padding-left");
  });

  // --- criterion 1: three controls, one cell, no column between them --------

  test("the AI select, the model select and the box share one cell (criterion 1)", () => {
    const html = rows();
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      // One cell, directly after the name's, and no separate AI column
      // anywhere on the page.
      expect([step, cellTags(line)[1]]).toEqual([step, '<td class="modelcell">']);
      const merged = cells(line)[1] ?? "";
      expect([step, merged.includes(`data-ai="model.${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes(`<select name="model.${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes(`data-phase="${step}"`)]).toEqual([step, true]);
      // In the order the choices are made in: the AI decides which
      // models there are, so it comes before the model it fills in.
      expect([step, merged.indexOf("data-ai=") < merged.indexOf(`<select name="model.${step}"`)]).toEqual([
        step,
        true,
      ]);
    }
    expect(html).not.toContain("toolcell");
    // Nothing spans anything. One control down five rows was what the
    // rowspan carried, and there is no such control left.
    expect([...html.matchAll(/rowspan="/g)]).toHaveLength(0);
    // The caption line carries the words, never a control.
    expect(caption(html)).not.toContain("<select");
  });

  test("a step outside the usual four shares its cell the same way (criterion 1)", () => {
    const html = rows([
      row({ id: "j1", specFolder: "192-one-cell", steps: ["manifest"], stepIndex: 0, state: "done" }),
    ]);
    expect(subRows(html)).toHaveLength(5);
    const line = subRow(html, "manifest");
    expect(cellTags(line)[1]).toBe('<td class="modelcell">');
    expect(cells(line)[1]).toContain('data-ai="model.manifest"');
    expect(cells(line)[1]).toContain('<select name="model.manifest"');
  });

  // --- criterion 3: the captions move with the controls they head -----------

  test("all three captions sit in the merged cell (criterion 3)", () => {
    const html = rows();
    const capCells = cells(caption(html));
    expect(capCells[0]).toContain(">Phase<");
    // Two tools configured, so the AI has a word (spec 179) — and it
    // stands in the same cell as the two it now sits beside, in the
    // order the controls under it are drawn.
    const merged = capCells[1] ?? "";
    expect(merged).toContain(">AI<");
    expect(merged).toContain(">Model<");
    expect(merged).toContain(">Select<");
    expect(merged.indexOf(">AI<") < merged.indexOf(">Model<")).toBe(true);
    expect(merged.indexOf(">Model<") < merged.indexOf(">Select<")).toBe(true);
    // `data-cap` is what pairs a caption with its control: the
    // stylesheet gives the two the same width, so "AI" stands over the
    // AI select instead of the three words running together at the
    // left edge of the cell (2026-08-22).
    expect(merged).toContain('data-cap="ai"');
    expect(merged).toContain('data-cap="model"');
    expect(merged).toContain('data-cap="box"');
    expect(caption(html)).toMatch(
      /<td class="modelcell"><span class="row"><span class="muted small" data-cap="ai" data-ai-cap>AI<\/span>/,
    );
  });

  // --- criterion 4: one configured tool draws no AI at all ------------------

  test("one configured tool leaves the merged cell to the model and the box (criterion 4)", () => {
    const html = rows([], { modelChoices: ONE });
    // One AI is nothing to choose between, so neither the picker nor
    // its caption is drawn — and no empty cell is left standing where
    // the AI column used to be.
    expect(html).not.toContain("data-ai");
    expect(html).not.toContain("toolcell");
    expect(cells(caption(html))[1]).not.toContain(">AI<");
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      expect([step, cellTags(line)[1]]).toEqual([step, '<td class="modelcell">']);
      const merged = cells(line)[1] ?? "";
      expect([step, merged.includes(`<select name="model.${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes(`data-phase="${step}"`)]).toEqual([step, true]);
      expect([step, merged.includes("<select data-ai")]).toEqual([step, false]);
    }
  });

  // --- criterion 6: the model select keeps its cap, wherever it sits --------

  test("the model select's width is capped by what it IS, not where it sits (criterion 6)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    // The floor and the cap the caption line and the boxes are lined
    // up by, unchanged in value from before the merge.
    expect(CSS).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 6.25rem; max-width: 100px; }',
    );
    // And selected by the select's own name, never by its position: an
    // AI select sits in front of it on a two-tool line, so a
    // `:first-child` rule would cap that one instead and let the model
    // select regrow to its widest option — the exact crowding this
    // spec removes.
    expect(CSS).not.toMatch(/\.modelcell > \.row > :first-child \{[^}]*min-width: 6\.25rem/);
    // The two-tool line really does put something else first, which is
    // what makes the sentence above more than a style preference.
    const both = cells(subRow(rows(), "analyze"))[1] ?? "";
    expect(both.indexOf("<select")).toBe(both.indexOf("<select data-ai"));
    // And the one-tool line puts the model select first, so the cap
    // has to hold in both arrangements.
    const one = cells(subRow(rows([], { modelChoices: ONE }), "analyze"))[1] ?? "";
    expect(one.indexOf("<select")).toBe(one.indexOf('<select name="model.analyze"'));
  });

  // --- criterion 9: seven columns, on every line -----------------------------

  test("the merge leaves six columns, and the caption matches them", () => {
    const html = rows();
    // Six since Created joined (spec 317); five from when the blank
    // trailing column went (2026-08-23); six before THAT, when the pips
    // moved in beside the spec's name and the Progress column went with
    // them. The caption line and every phase line write the same
    // number, or the table stops lining up with its own head row.
    expect(cells(caption(html))).toHaveLength(6);
    for (const step of ["create", "analyze", "implement", "archive"]) {
      expect([step, cells(subRow(html, step)).length]).toEqual([step, 6]);
      // The third cell is the phase's own state now, not the empty one
      // the Progress column left behind.
      expect([step, cells(subRow(html, step))[2]]).toEqual([
        step,
        '<span class="muted small">not run yet</span>',
      ]);
    }
    expect([...html.matchAll(/rowspan="/g)]).toHaveLength(0);
  });

  // --- criterion 8: the script still finds the control ---------------------

  // The control posts nothing and finds the select it writes through
  // the `form` id and `data-ai` together (`applyAiPick`,
  // `queue-client.ts`). Neither depends on which `<td>` it sits in —
  // but both are markup this file writes, and moving the control into
  // the cell beside it is exactly the edit that could drop one without
  // a type error to say so.
  test("each line's control names its own form and its own model (criterion 8)", () => {
    const html = rows();
    const formId = html.match(/<form id="([^"]+)"/)![1];
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const control = subRow(html, step).match(/<select[^>]*data-ai[^>]*>/)![0];
      // It posts nothing: the five `model.<step>` fields are still the
      // whole of what a press sends.
      expect([step, control.includes("name=")]).toEqual([step, false]);
      expect([step, control.includes(`form="${formId}"`)]).toEqual([step, true]);
      expect([step, control.includes(`data-ai="model.${step}"`)]).toEqual([step, true]);
    }
  });

  // --- criterion 5: a folded phase line at phone width ----------------------

  test("at phone width the AI/model pair folds behind the phase's chevron (criterion 5)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    const narrow = CSS.slice(CSS.indexOf("@media (max-width: 40rem) {"));
    // Since the mobile-spec-row handoff (2026-08-24) a phase line is a
    // flex row at this width — identical open or shut — with the cells
    // dissolved (display:contents), and the AI/model pair hidden until
    // the phase's own fold checkbox shows it.
    expect(narrow).toMatch(/table\.list tr\.subrow \{ display: flex;/);
    expect(narrow.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .modelcell, table.list tr.subrow .modelcell > .row " +
        "{ display: contents; }",
    );
    expect(narrow).toContain("table.list tr.subrow .aimodel { display: none; }");
    // And the widths the two selects reserve on a desktop are given
    // back — min AND max, or the 50/50 split never happens.
    expect(narrow).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; max-width: none; }',
    );
    // The pinned flex bases the three-in-one cell needed before spec
    // 165 stay gone: the widths are not pinned by hand this time.
    expect(CSS).not.toContain(".phasecell > .row");
    expect(CSS).not.toMatch(/\.modelcell[^{]*\{[^}]*flex: 0 0/);
  });
});
