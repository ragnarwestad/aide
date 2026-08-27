import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type ArchivedSpecView,
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
// So the AI select, the model select and the phase's box share ONE
// cell now — the cell the model select and the box already shared —
// and the three captions share the caption row's. The name keeps a
// cell of its own, hard left, untouched. The column the merge vacates
// is the one the head row's own pips occupy, and it goes back to being
// empty on a phase line, exactly as it was before spec 165. Seven
// columns either way.
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

  test("the merge leaves five columns, and the caption matches them", () => {
    const html = rows();
    // Five since the blank trailing column went (2026-08-23); six
    // before that, when the pips moved in beside the spec's name and
    // the Progress column went with them. The caption line and every
    // phase line write the same number, or the table stops lining up
    // with its own head row.
    expect(cells(caption(html))).toHaveLength(5);
    for (const step of ["create", "analyze", "implement", "archive"]) {
      expect([step, cells(subRow(html, step)).length]).toEqual([step, 5]);
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

// --- spec 169: one picker per phase, AI and model together -------------------
//
// The row offered ONE AI for the whole spec and a model per phase, which
// read as though the tool were a decision made once. It never was: the
// runner reads `job.model[step]` for every step independently and
// derives both `--model` and `--tool` from that one entry, so a row can
// run analyze on Claude Code and implement on Codex today.
//
// The AI select posted nothing. All it did was hide the other tool's
// models from the five phase selects — which is precisely what stopped
// anyone discovering that a row can mix them. It goes, and the models
// are grouped by tool in the selects themselves.
//
// What took its slot — a "set all" control for the whole group — is
// gone again in spec 179, and what is left here is the half of spec
// 169 that outlived it: every phase select offers every model, grouped
// by tool, hiding nothing, with the fallbacks that decide which one is
// pre-filled.
describe("spec 169: one picker per phase", () => {
  const target = (specFolder = "169-one-picker"): QueueTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  /** Codex FIRST, so a fallback that took `modelChoices`'s head can be
   *  told from one that took the row's old resting tool. */
  const CODEX_FIRST = [
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
    { name: "sonnet", budgetUsd: 3 },
  ];
  const ONE_TOOL = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

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
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  const STEPS = ["create", "analyze", "implement", "archive"];
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";

  // --- criterion 1 -----------------------------------------------------------

  test("every phase select offers every model, grouped by tool", () => {
    const html = rows();
    for (const step of STEPS) {
      const select = phaseSelect(html, step);
      expect([step, select !== ""]).toEqual([step, true]);
      expect([step, select.includes('<optgroup label="Claude Code">')]).toEqual([step, true]);
      expect([step, select.includes('<optgroup label="Codex">')]).toEqual([step, true]);
      // Every model, and none of them hidden: hiding half the list is
      // what stopped a reader discovering the row can mix tools.
      for (const m of BOTH) {
        expect([step, m.name, select.includes(`value="${m.name}"`)]).toEqual([step, m.name, true]);
      }
      expect([step, select.includes("hidden")]).toEqual([step, false]);
      // `data-tool` came back in spec 179 — read to say which AI a
      // model belongs to, never to hide one. The assertion that
      // nothing is hidden, right above, is what keeps the two apart.
      expect([step, /<option value="gpt-fast" data-tool="codex"/.test(select)]).toEqual([step, true]);
      expect([step, /<option value="sonnet" data-tool="claude"/.test(select)]).toEqual([step, true]);
      // The option's text is the model's name and nothing else — no
      // "(codex)" suffix (spec 167); the group above it says the tool
      // while the list is open, the name itself while it is closed.
      expect([step, select.includes("(codex)")]).toEqual([step, false]);
      expect([step, /<option value="gpt-fast"[^>]*>gpt-fast<\/option>/.test(select)]).toEqual([step, true]);
    }
    // The grouping is in the configured tool order — Claude Code, then
    // Codex — not whichever tool `modelChoices` happens to lead with.
    const first = phaseSelect(rows([], { modelChoices: CODEX_FIRST }), "analyze");
    expect(first.indexOf('label="Claude Code"')).toBeLessThan(first.indexOf('label="Codex"'));
  });

  test("a tool with no model configured draws no group of its own", () => {
    const select = phaseSelect(rows([], { modelChoices: ONE_TOOL }), "analyze");
    expect(select).toContain('<optgroup label="Claude Code">');
    expect(select).not.toContain("Codex");
  });

  // --- criterion 2 -----------------------------------------------------------

  test("no row-wide AI filter is drawn anywhere any more", () => {
    const html = rows();
    expect(html).not.toContain("data-tool-picker");
    // Nor the word the filter's own label carried: the AI is said in
    // the caption and in the option groups now, not in a control of
    // its own.
    expect(html).not.toMatch(/<label[^>]*>AI <select/);
  });

  // --- criterion 5's server half: what a phase has already run on -----------

  // `used` is what pre-fills a select with the model its phase really
  // ran on, and `data-ran="1"` is that fact said to the browser. It was
  // "set all"'s scope until spec 179 removed the control; it stays
  // because the server saying which phases have history, rather than
  // the browser re-deriving it, is the part worth keeping.
  test("a phase that has run says so on its select, and one that has not does not", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
    ]);
    expect(phaseSelect(html, "analyze").match(/<select[^>]*>/)![0]).toContain('data-ran="1"');
    for (const step of ["implement", "archive"]) {
      expect([step, phaseSelect(html, step).match(/<select[^>]*>/)![0].includes("data-ran")]).toEqual([step, false]);
    }
  });

  // --- criterion 7: the no-JS floor -----------------------------------------

  // Filling a model in from an AI is a script's job, and every control
  // on this page works without one. Without a script the AI select
  // must simply not be there: it writes the model select and does
  // nothing else, so one that looks pressable and silently does
  // nothing would be worse than the removed AI filter's inert
  // degradation ever was. Its caption goes with it — a column headed
  // "AI" with nothing under it reads as broken.
  test("with no script the AI selects are hidden, and the phase selects are not", () => {
    const html = rows();
    expect(html).toContain(
      "<noscript><style>[data-ai],[data-ai-cap]{display:none}</style></noscript>",
    );
    // The five selects underneath stay exactly as usable as they are
    // with a script: every model, in every one of them, unfiltered.
    for (const step of STEPS) {
      const select = phaseSelect(html, step);
      for (const m of BOTH) {
        expect([step, m.name, select.includes(`value="${m.name}"`)]).toEqual([step, m.name, true]);
      }
      expect([step, select.includes("hidden")]).toEqual([step, false]);
    }
  });

  // --- criterion 8 -----------------------------------------------------------

  // The merged "AI - Model" word spoke for a column the AI did not
  // have. Spec 179 gives it one, so the two are two words over two
  // columns and the model's is the single word it always names.
  test("the caption gives the AI a word of its own when there are two to tell apart", () => {
    const cap = caption(rows());
    expect(cap).toContain(">AI<");
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain("AI - Model");
  });

  test("one tool is nothing to tell apart, so only the model is named", () => {
    const cap = caption(rows([], { modelChoices: ONE_TOOL }));
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain(">AI<");
    expect(cap).not.toContain("AI - Model");
  });

  // --- criterion 9 -----------------------------------------------------------

  // The fallback for an unconfigured, never-run phase was biased toward
  // the row's "resting tool" (spec 141, spec 164). There is no resting
  // tool any more, so it is the first entry the configuration lists —
  // whatever tool that entry starts.
  test("an unconfigured, never-run phase falls back to the first configured model", () => {
    const html = rows([], { modelChoices: CODEX_FIRST });
    for (const step of STEPS) {
      const select = phaseSelect(html, step);
      expect([step, /<option value="gpt-fast"[^>]*selected/.test(select)]).toEqual([step, true]);
      expect([step, /<option value="sonnet"[^>]*selected/.test(select)]).toEqual([step, false]);
    }
  });

  // And nothing another phase ran on moves it: the row has no one tool
  // to rest on any more, so a Codex history on implement leaves the
  // phases with no history of their own exactly where they were.
  test("what one phase ran on does not decide another phase's fallback", () => {
    const html = rows([
      row({
        id: "j1", specFolder: "169-one-picker", steps: ["implement"],
        stepIndex: 0, state: "done", model: "gpt-fast",
      }),
    ]);
    expect(phaseSelect(html, "implement")).toMatch(/<option value="gpt-fast"[^>]*selected/);
    // `sonnet` leads BOTH, and leads it still.
    expect(phaseSelect(html, "analyze")).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // A configured default outranks the fallback exactly as it always did.
  test("a configured default still wins over the first entry", () => {
    const select = phaseSelect(rows([], { defaultModels: { default: "gpt-fast" } }), "analyze");
    expect(select).toMatch(/<option value="gpt-fast"[^>]*selected/);
  });

  // --- the lock a busy row puts on every control on it (spec 105, 151) ------

  test("a busy row locks its AI selects for the same reason as its models", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "running" }),
    ]);
    const control = html.match(/<select[^>]*data-ai[^>]*>/)![0];
    expect(control).toContain("disabled");
    expect(control).toContain('title="implement is running"');
  });

  test("a settled row's AI selects are live again", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "done" }),
    ]);
    expect(html.match(/<select[^>]*data-ai[^>]*>/)![0]).not.toContain("disabled");
  });
});

// --- spec 179: an AI and a model on every phase line -------------------------
//
// The row's one "set all" control is gone, and every phase line carries
// an AI select of its own beside its model select instead. Choosing an
// AI for a phase fills in the model for that same phase, and nothing
// else on the row moves.
//
// The AI select posts NOTHING and states nothing the job does not
// already hold: what a phase runs on stays one value on the job — the
// `model.<step>` field — and the tool is derived from it. So the
// select is READ on change, to fill the model in, and WRITTEN on
// redraw, to reflect it. Never the reverse, and never a second field.
//
// Which model an AI stands for is answered HERE, where the
// configuration is, and carried into the markup on each option's
// `data-default`: the step's configured default when that default
// belongs to the tool, else the first entry `modelChoices` lists for
// it. The browser copies a value; it never chooses one.
describe("spec 179: an AI and a model on every phase line", () => {
  const target = (specFolder = "179-ai-per-phase"): QueueTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
  ];
  /** Codex FIRST, so a fallback that took `modelChoices`'s head can be
   *  told from one that took a literal "claude". */
  const CODEX_FIRST = [
    { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const },
    { name: "sonnet", budgetUsd: 3 },
  ];
  const ONE_TOOL = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

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
        modelChoices: BOTH,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  const STEPS = ["create", "analyze", "implement", "archive"];
  const aiSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select[^>]*data-ai="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";

  // --- criterion 1: one AI per phase, beside that phase's model ------------

  test("every phase line has an AI select, and it names its own model select", () => {
    const html = rows();
    for (const step of STEPS) {
      const select = aiSelect(html, step);
      expect([step, select !== ""]).toEqual([step, true]);
      // It sits BEFORE the model select it writes, on the same line.
      const line = html.match(new RegExp(`<tr class="subrow"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))![0];
      expect([step, line.indexOf("data-ai=") < line.indexOf(`name="model.${step}"`)]).toEqual([step, true]);
      // One option per configured tool, in the page's own order —
      // Claude Code first, whichever tool `modelChoices` happens to
      // lead with — and the tool's reader-facing name, not the
      // config's short word.
      expect([step, [...select.matchAll(/<option /g)].length]).toEqual([step, 2]);
      expect([step, select.indexOf(">Claude Code<") < select.indexOf(">Codex<")]).toEqual([step, true]);
      expect([step, select.includes('value="claude"')]).toEqual([step, true]);
      expect([step, select.includes('value="codex"')]).toEqual([step, true]);
    }
    const first = aiSelect(rows([], { modelChoices: CODEX_FIRST }), "analyze");
    expect(first.indexOf(">Claude Code<")).toBeLessThan(first.indexOf(">Codex<"));
  });

  test("a tool with no model configured is not offered as an AI", () => {
    // One tool is nothing to choose between, so the control is not
    // drawn at all — the count that decides it is TOOLS, not models.
    const html = rows([], { modelChoices: ONE_TOOL });
    for (const step of STEPS) expect([step, aiSelect(html, step)]).toEqual([step, ""]);
    expect(html).not.toContain("data-ai");
    // And the model selects underneath are untouched by any of it.
    expect(html).toContain('<select name="model.analyze"');
  });

  test("no model configured at all draws no AI select either", () => {
    expect(rows([], { modelChoices: undefined })).not.toContain("data-ai");
  });

  // --- criterion 2: the model an AI fills in is worked out here ------------

  test("each option carries the model its tool fills in", () => {
    const select = aiSelect(rows(), "analyze");
    // The first entry `modelChoices` lists for that tool, in
    // configuration order — `fable` is a Claude model too and does not
    // lead.
    expect(select).toMatch(/<option value="claude" data-default="sonnet"/);
    expect(select).toMatch(/<option value="codex" data-default="gpt-fast"/);
  });

  test("a step's configured default is what its own tool fills in", () => {
    const html = rows([], { defaultModels: { analyze: "fable" } });
    // Configuration named a model for this step, and it is a Claude
    // one — so picking Claude Code gives it back rather than the
    // tool's first entry.
    expect(aiSelect(html, "analyze")).toMatch(/<option value="claude" data-default="fable"/);
    // The other tool has no configured opinion, so it falls through.
    expect(aiSelect(html, "analyze")).toMatch(/<option value="codex" data-default="gpt-fast"/);
    // And it is the STEP's default, not the row's: implement was not
    // named, so it keeps the tool's first entry.
    expect(aiSelect(html, "implement")).toMatch(/<option value="claude" data-default="sonnet"/);
  });

  test("a configured default belonging to the other tool is left to that tool", () => {
    const html = rows([], { defaultModels: { default: "gpt-fast" } });
    const select = aiSelect(html, "analyze");
    expect(select).toMatch(/<option value="codex" data-default="gpt-fast"/);
    expect(select).toMatch(/<option value="claude" data-default="sonnet"/);
  });

  // --- criterion 3's server half: the AI shown is the model's own ----------

  test("the AI shown is the tool of the model the phase is actually on", () => {
    const html = rows();
    // Nothing configured and nothing run: the model select falls back
    // to the first entry, and the AI select says whose it is.
    for (const step of STEPS) {
      expect([step, /<option value="claude"[^>]*selected/.test(aiSelect(html, step))]).toEqual([step, true]);
      expect([step, /<option value="codex"[^>]*selected/.test(aiSelect(html, step))]).toEqual([step, false]);
    }
    // Move the model, and the AI moves with it — the same fallback
    // decides both, so the two cannot disagree.
    const codexFirst = rows([], { modelChoices: CODEX_FIRST });
    expect(phaseSelect(codexFirst, "analyze")).toMatch(/<option value="gpt-fast"[^>]*selected/);
    expect(aiSelect(codexFirst, "analyze")).toMatch(/<option value="codex"[^>]*selected/);
  });

  test("a phase that ran on the other tool says so, and its neighbours do not", () => {
    const html = rows([
      row({
        id: "j1", specFolder: "179-ai-per-phase", steps: ["implement"],
        stepIndex: 0, state: "done", model: "gpt-fast",
      }),
    ]);
    expect(aiSelect(html, "implement")).toMatch(/<option value="codex"[^>]*selected/);
    expect(aiSelect(html, "analyze")).toMatch(/<option value="claude"[^>]*selected/);
  });

  // --- criterion 6: the control it replaces is gone ------------------------

  test("no set-all control exists anywhere on the page", () => {
    const html = rows();
    expect(html).not.toContain("data-set-all");
    expect(html).not.toContain("Set all");
    // Nor the caption cell it used to leave empty for itself.
    expect(caption(html)).not.toContain("<select");
  });

  // --- criterion 8: nothing new is posted ---------------------------------

  test("the AI select posts nothing at all", () => {
    const html = rows();
    for (const step of STEPS) {
      const tag = aiSelect(html, step).match(/<select[^>]*>/)![0];
      expect([step, tag.includes("name=")]).toEqual([step, false]);
    }
    // The whole page offers exactly the five model fields it always
    // did — one per phase, and nothing beside them.
    expect([...html.matchAll(/<select name="/g)]).toHaveLength(STEPS.length);
  });
});

// Spec 176: four things the row still said wrong. Three of them are
// about what a cell SAYS; this block holds the two that a rendered
// string can be asked about directly — the chip's border, and where a
// phase line's aside note goes.
describe("spec 176: the phase chip frames nothing", () => {
  test("a phase line's label-less chip draws no border (criterion 1)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS).toContain(".phase[data-phase] { border-color: transparent; }");
  });

  // The second half of the criterion, and the reason the selector names
  // `data-phase` rather than `.phase`: a chip written with a label of
  // its own — the "Also touches" repo chips (`data-project`) and the
  // new-spec form's "Depends on" (`data-depends`) — frames something,
  // and keeps its frame.
  test("the transparent border reaches no chip that has a label (criterion 1)", async () => {
    const { CSS } = await import("../../../../src/render/ui/css.ts");
    expect(CSS.match(/\n\.phase \{[\s\S]*?\}/)![0]).toContain("border: 1px solid var(--line)");
    expect(CSS.match(/^[^\n]*border-color: transparent[^\n]*$/gm)).toEqual([
      ".phase[data-phase] { border-color: transparent; }",
    ]);
  });
});

// --- spec 195: a phase line shows its mark and nothing else -------------------
//
// A qualifier is a sentence, and spec 108 drew it in a `<div>` under the
// phase's badge. A `<div>` is a line of its own, so a phase with
// something to say was taller than the phase above it — and everything
// below the row moved the moment a run started, stopped, or a status
// file fell out of step with the git history. Spec 176 already moved the
// stale mark and the tries count BESIDE the badge for exactly this
// reason; the qualifier is the occupant it did not touch.
//
// The sentence is not lost: it goes into the panel spec 143 built for
// "a sentence too long for a cell", named for the phase it is about.
describe("spec 195: a phase line shows its mark and nothing else", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...extra,
      },
      Date.parse("2026-08-22T12:00:00Z"),
    );
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const BUILT = ["analyze", "implement"];

  // Criterion 4: the ordinary case, and the one that must stay silent.
  // A phase whose file and history agree has nothing to say anywhere —
  // a panel that repeats what a badge already shows is the same clutter
  // in a new place.
  test("a phase whose file and history agree says nothing, on the line or in the panel", () => {
    const html = rows([], [target("195-agreeing", { done: ["analyze"] })]);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "analyze")).not.toContain("disagree");
    expect(panel(html)).toBe("");
  });

  // Criterion 5: two phases disagreeing at once is the case
  // 1-description.md flags ("three of these can fire at once"). The
  // panel has one slot, so it states the EARLIEST phase in workflow
  // order and names it — never an arbitrary pick, and never a
  // concatenation that grows without bound.
  test("two disagreeing phases collapse to the earlier one, named", () => {
    const html = rows(
      [
        row({ id: "reanalyze", specFolder: "195-both", steps: ["analyze"], state: "cancelled" }),
        row({ id: "impl", specFolder: "195-both", steps: ["implement"], state: "done" }),
      ],
      [target("195-both", { done: ["analyze"] })],
    );
    expect(panel(html)).toContain("analyze: last re-run cancelled");
    expect(panel(html)).not.toContain("implement:");
    expect(subRow(html, "analyze")).not.toContain("last re-run cancelled");
    expect(subRow(html, "implement")).not.toContain("disagree");
  });

  // Criterion 6: the rule itself, rather than one string at a time. No
  // phase line, in any state `wordPhase()` can produce, carries a
  // block-level element — which is what made one line taller than
  // another.
  test("no phase line carries block-level free text, in any state", () => {
    const cases: { name: string; html: string; step: string }[] = [
      {
        name: "done, agreeing",
        html: rows([], [target("195-a", { done: ["analyze"] })]),
        step: "analyze",
      },
      {
        name: "done, with a re-run that disagrees",
        html: rows(
          [row({ id: "c", specFolder: "195-b", steps: ["analyze"], state: "cancelled" })],
          [target("195-b", { done: ["analyze"] })],
        ),
        step: "analyze",
      },
      {
        name: "held back",
        html: rows(
          [row({ id: "h", specFolder: "195-c", steps: ["archive"], state: "done" })],
          [target("195-c", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
        ),
        step: "archive",
      },
      {
        name: "held back, with a qualifier of its own",
        html: rows(
          [row({ id: "h2", specFolder: "195-d", steps: ["archive"], state: "failed" })],
          [target("195-d", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
        ),
        step: "archive",
      },
      {
        name: "stopped, with no attempt left to say so",
        html: rows([], [target("195-e", { done: ["analyze"], stopped: { implement: "timeout" } })]),
        step: "implement",
      },
      {
        name: "the files disagree and nothing has been attempted",
        html: rows([], [target("195-f", { done: ["analyze"], fileDisagrees: ["implement"] })]),
        step: "implement",
      },
      {
        name: "running",
        html: rows(
          [row({ id: "r", specFolder: "195-g", steps: ["analyze"], state: "running" })],
          [target("195-g")],
        ),
        step: "analyze",
      },
    ];
    for (const c of cases) {
      expect(subRow(c.html, c.step)).not.toBe("");
      expect(`${c.name}: ${subRow(c.html, c.step)}`).not.toContain('<div class="muted small">');
    }
  });

  // Criterion 7: the new producer is the LOWEST of the four. A refusal
  // answers a button the reader just pressed, and a job's own error says
  // why the row is not moving — both outrank a standing disagreement.
  test("a refusal outranks a phase's disagreement in the panel", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "195-refused", steps: ["implement"], state: "done" })],
      [target("195-refused", { done: ["analyze"] })],
      { errorSpec: "aide/195-refused", error: "a job is already queued for this spec" },
    );
    expect(panel(html)).toContain("a job is already queued for this spec");
    expect(panel(html)).not.toContain("the files disagree");
  });

  test("a job's own error outranks a phase's disagreement in the panel", () => {
    const html = rows(
      [
        row({
          id: "impl",
          specFolder: "195-errored",
          steps: ["implement"],
          state: "failed",
          error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
        }),
      ],
      [target("195-errored", { done: ["analyze"], fileDisagrees: ["analyze"] })],
    );
    expect(panel(html)).toContain("the specs tree is dirty");
    expect(panel(html)).not.toContain("the files disagree");
  });
});

// --- spec 210: a running implement says which third it is in -----------------
//
// An implement runs for an hour and the row says only "running". Which
// of its three parts it is in — writing the failing tests, making them
// pass, or the suite afterwards — is the difference between nearly done
// and barely started. `aide-implement` already reports each boundary and
// `AideRunStore` already keeps it; nothing read it.
//
// Two readers, one field. The phase LINE says the word (`running
// (green)`); the spec head row's pip fills a third at a time. The pip's
// own width never changes — a pip that grew would move everything on the
// line beside it.
describe("spec 210: a running implement says which third it is in", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...extra,
      },
      Date.parse("2026-08-23T12:00:00Z"),
    );
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The spec head row's pip strip — where the fill lives. The phase
   *  lines below carry no pip of their own. */
  const pipStrip = (html: string, specFolder: string) =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${specFolder}">[\\s\\S]*?</tr>`))?.[0]
      .match(/<div class="pips">[\s\S]*?<\/div>/)?.[0] ?? "";
  /** The one pip in that strip that is the running one. `data-third` on
   *  any other pip would be the mark answering the wrong question. */
  const nowPip = (html: string, specFolder: string) =>
    pipStrip(html, specFolder).match(/<span class="pip now"[^>]*>/)?.[0] ?? "";

  // Criterion 2. `green` means RED is behind it: one third of three, not
  // two. The natural-looking mapping is off by one and nothing in the
  // type system catches it, so the worked value is pinned here.
  test("a running implement in GREEN reads (green) and fills one third", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-green", steps: ["implement"], state: "running", tddPhase: "green" })],
      [target("210-green")],
    );
    expect(subRow(html, "implement")).toContain("running (green)");
    expect(nowPip(html, "210-green")).toContain('data-third="1"');
  });

  // Criterion 3.
  test("a running implement in REFACTOR reads (refactor) and fills two thirds", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-ref", steps: ["implement"], state: "running", tddPhase: "refactor" })],
      [target("210-ref")],
    );
    expect(subRow(html, "implement")).toContain("running (refactor)");
    expect(nowPip(html, "210-ref")).toContain('data-third="2"');
  });

  // Criterion 4: zero thirds complete renders identically to "no report
  // arrived". A pip that looked 1/3 done five seconds into RED would
  // actively misinform, which is worse than saying nothing.
  test("a running implement in RED reads (red) and fills nothing", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-red", steps: ["implement"], state: "running", tddPhase: "red" })],
      [target("210-red")],
    );
    expect(subRow(html, "implement")).toContain("running (red)");
    expect(nowPip(html, "210-red")).not.toContain("data-third");
  });

  // Criterion 6: the report never arrived. Nothing throws, and the row
  // reads exactly as it does today.
  test("a running implement nobody reported on reads plain running, unfilled", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-silent", steps: ["implement"], state: "running" })],
      [target("210-silent")],
    );
    expect(subRow(html, "implement")).toContain("running");
    expect(subRow(html, "implement")).not.toContain("running (");
    expect(nowPip(html, "210-silent")).not.toContain("data-third");
  });

  // Criterion 5: analyze has no phase reports and is out of scope, so
  // its rows arrive without a `tddPhase` and read as they always did.
  // WHICH steps are given one is `jobRow`'s rule and is asserted where
  // that rule lives, in queue-detail.test.ts — naming the step a second
  // time here would be a second copy of it, which is this repo's own
  // recurring cost.
  test("a running step that is not implement is untouched", () => {
    const html = rows(
      [row({ id: "an", specFolder: "210-analyze", steps: ["analyze"], state: "running" })],
      [target("210-analyze")],
    );
    expect(subRow(html, "analyze")).toContain("running");
    expect(subRow(html, "analyze")).not.toContain("running (");
    expect(pipStrip(html, "210-analyze")).not.toContain("data-third");
  });

  // A job WAITING to start is in no TDD phase at all. Its own trap:
  // `inFlight` — what the phase word branches on — is queued OR
  // running, so a leftover report would have read "queued (refactor)".
  test("a queued implement carrying a phase still reads plain queued", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-waiting", steps: ["implement"], state: "queued", tddPhase: "green" })],
      [target("210-waiting")],
    );
    expect(subRow(html, "implement")).toContain("queued");
    expect(subRow(html, "implement")).not.toContain("(green)");
    expect(pipStrip(html, "210-waiting")).not.toContain("data-third");
  });

  // Criterion 7: the phase is over. A stale entry from the session it
  // once used must not fill a pip for a run that has stopped, nor
  // qualify a word that is no longer "running".
  test("an implement that is NOT running ignores a leftover phase", () => {
    for (const state of ["queued", "done", "failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ id: "impl", specFolder: "210-over", steps: ["implement"], state, tddPhase: "refactor" })],
        [target("210-over")],
      );
      expect(subRow(html, "implement")).not.toContain("(refactor)");
      expect(pipStrip(html, "210-over")).not.toContain("data-third");
    }
  });
});

// The markup half on its own: `pips()` is shared by the list and the job
// page, and the mark is only ever about the pip that is running.
describe("spec 210: pips() marks the completed thirds", () => {
  test("a now pip with a third carries the attribute", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "now", title: "implement", third: 1 }])).toContain('data-third="1"');
    expect(pips([{ kind: "now", title: "implement", third: 2 }])).toContain('data-third="2"');
  });

  test("a now pip without a third carries nothing, exactly as before", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "now", title: "implement" }])).toBe(
      `<div class="pips"><span class="pip now" title="implement"></span></div>`,
    );
  });

  test("a past or todo pip never carries the mark, whatever it is handed", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "past", title: "analyze", third: 2 }])).not.toContain("data-third");
    expect(pips([{ kind: "todo", title: "archive", third: 1 }])).not.toContain("data-third");
  });
});

// Spec 265: an archived phase line draws the SAME aiPicker/modelPicker
// controls a live one does, disabled, instead of a second, hand-rolled
// rendering (`lockedModel`, removed). The route-level suite
// (`archived-specs.test.ts`) covers the parse-through-render path; this
// is the renderer on its own, with one fixture the bigger harness could
// not shape as precisely — a recorded model string with no space at all.
describe("spec 265: an archived phase line looks like a live one", () => {
  const TOOLS: NonNullable<QueuePageOptions["modelChoices"]> = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" },
  ];

  const archivedFixture = (folder: string, models: Record<string, string>): ArchivedSpecView => ({
    project: "aide",
    folder,
    archivedAt: "2026-08-15",
    done: ["create", "analyze"],
    models,
    phaseOutcomes: {},
  });

  /** One phase line's own markup, off a single-spec archived page opened
   *  the way the fold chevron opens it. */
  const openLine = (models: Record<string, string>, step: string): string => {
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [],
      modelChoices: TOOLS,
      defaultModels: { default: "sonnet" },
      archivedSpecs: [archivedFixture("50-archived", models)],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    return html.match(new RegExp(`<tr class="subrow"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))![0];
  };

  // The live Specs page always draws a real select through `modelOptions`
  // — every configured choice, one marked `selected`. A locked phase line
  // now draws the exact same markup, disabled, with the bare recorded
  // name selected — never the "<tool> <model>" record itself, which is
  // what used to clip to "claude so".
  test("shows the bare recorded model name, disabled, never the tool-prefixed record (criterion 1)", () => {
    const line = openLine({ analyze: "claude sonnet" }, "analyze");
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
    );
    expect(line).not.toContain("claude sonnet");
  });

  // A phase that never ran (`create`, on every archived spec today) reads
  // exactly as a live, not-yet-run phase does: the configured default,
  // never blank.
  test("shows the configured default, disabled, for a step that recorded no model — never blank (criterion 2)", () => {
    const line = openLine({}, "analyze");
    expect(line).toContain("<select");
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
    );
  });

  // A model a spec ran on can be retired or renamed by the time anyone
  // reads the archive back — the record must still win, verbatim, rather
  // than being silently swapped for whatever is configured today.
  test("still shows the exact recorded model when it is no longer a configured choice (criterion 3)", () => {
    const line = openLine({ analyze: "claude gpt-9000-old" }, "analyze");
    expect(line).toContain(" disabled");
    expect(line).toContain('<option value="gpt-9000-old" selected>gpt-9000-old</option>');
    expect(line).not.toContain("claude gpt-9000-old");
  });

  // Risk analysis's third risk: `model_value="$tool"` alone (no `$model`)
  // is the shape a run with no `--model` given leaves behind — no space
  // at all, so `phaseSubRows`'s own split (`phase-rows.ts`) yields no
  // model half. Under this fix that reads exactly as "no record": a shown,
  // disabled select pre-filled with the configured default, never a
  // crash and never blank.
  test("a recorded model with no space at all still resolves to a shown value, not a blank cell", () => {
    const line = openLine({ analyze: "claude" }, "analyze");
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
    );
  });
});
