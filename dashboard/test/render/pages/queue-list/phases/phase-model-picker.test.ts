import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { aiPicker, modelPicker, type PickerOptions } from "../../../../../src/render/pages/queue-list/model-picker.ts";
import { type SpecGroup } from "../../../../../src/render/pages/queue-list/data-model.ts";
import { row, openKeys } from "../../fixtures.ts";

// --- spec 123: the model is chosen on the phase line -------------------------
//
// Split out of listing-and-units.test.ts by theme.
//
// One dropdown for the whole row used to sit on the controls line
// between Run and the other rarely-set fields, carrying option labels
// like "fable — $12 per step". It landed beside the State column by
// accident of content width, tied to nothing around it, and the phase
// lines below it showed their model as dead text with a wide empty gap
// before it.
//
// The choice belongs where the phase is: each phase line carries its
// own picker, under a "Phase"/"Model" caption, and the budget figure
// moves off the label into the option's own tooltip — the number still
// reachable, no longer read out on every option.
describe("spec 123: each phase line picks its own model", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const CHOICES = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("123-picks")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: CHOICES,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The caption line: a subrow with no phase of its own, above them
   *  all. Marked by a data attribute rather than a class — it needs no
   *  rule of its own, and the render vocabulary is a closed set
   *  (`css-token-guard.test.ts`). */

  // --- criterion 1 -----------------------------------------------------------

  test("the row's own controls carry no shared Model select any more", () => {
    const html = rows([]);
    expect(controlsLine(html, "123-picks")).not.toBe("");
    expect(controlsLine(html, "123-picks")).not.toContain('name="model"');
    // Nor anywhere else on the row: the whole-job field is gone, not moved.
    expect(html).not.toContain('<select name="model"');
  });

  // --- criterion 2 -----------------------------------------------------------

  test("every phase line carries its own select, on the row's Run form", () => {
    const html = rows([]);
    const id = controlsLine(html, "123-picks").match(/<form id="([^"]+)"/)![1];
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      expect(line).not.toBe("");
      const select = line.match(new RegExp(`<select name="model\\.${step}"[^>]*>`))?.[0] ?? "";
      expect(select).not.toBe("");
      // It is written outside the form's own tags, so only the `form`
      // attribute carries it back — an id that drifts runs the job on
      // the defaults instead, silently.
      expect(select).toContain(`form="${id}"`);
    }
  });

  // No "default" entry (asked for 2026-08-19): the select holds real
  // names only, pre-filled with what the configuration would give the
  // step when the phase has not run yet.
  test("the options are the real names, pre-filled with the configured model", () => {
    const line = subRow(rows([], [target("123-picks")], { defaultModels: { default: "sonnet" } }), "analyze");
    const modelSelect = line.match(/<select name="model\.analyze"[\s\S]*?<\/select>/)?.[0] ?? "";
    // Spec 364's own effort select DOES carry an empty "unset" option,
    // beside this one — scoped here so that addition does not read as
    // this select's own name-only promise breaking.
    expect(modelSelect).not.toContain('<option value=""');
    expect(modelSelect).toMatch(/<option value="sonnet"[^>]*selected/);
    expect(modelSelect).toContain('value="fable"');
  });

  test("a per-step configured model beats the catch-all default", () => {
    const line = subRow(
      rows([], [target("123-picks")], { defaultModels: { analyze: "fable", default: "sonnet" } }),
      "analyze",
    );
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("no option label reads out a budget figure", () => {
    const html = rows([]);
    for (const option of html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)) {
      expect(option[1]).not.toContain("$");
    }
  });

  test("the figure is still reachable — it moved to the option's tooltip", () => {
    const line = subRow(rows([]), "analyze");
    expect(line).toContain('title="$12 per step"');
  });

  // --- criterion 3 -----------------------------------------------------------

  /** The caption line above the phase lines. */
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";

  test("a Phase/Model caption sits directly above the phase lines", () => {
    const html = rows([]);
    const cap = caption(html);
    expect(cap).toContain(">Phase<");
    // `CHOICES` is one tool's models: one AI to name rather than one to
    // choose between, and the column is headed all the same — a heading
    // the controls under it can be lined up against, in every project.
    expect(cap).toContain(">Model<");
    expect(cap).toContain(">AI<");
    // Between the spec's own line and the first phase line. (The
    // caption itself is compared with its stack cell stripped, so the
    // ordering is read off the row tag rather than the text.)
    const at = html.indexOf('<tr class="subrow" data-caption="1">');
    expect(at).toBeGreaterThan(html.indexOf('data-folder="123-picks"'));
    expect(at).toBeLessThan(html.indexOf('data-step="create"'));
  });

  // The tool is no longer a choice made once for the row (spec 169) and
  // it has a picker on every phase line (spec 179), so the caption
  // names two columns where it named one. It read "AI - Model" over the
  // model's column alone in between.
  test("with two tools configured the caption names the AI column too", () => {
    const cap = caption(
      rows([], [target("123-picks")], {
        modelChoices: [...CHOICES, { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const }],
      }),
    );
    expect(cap).toContain(">Phase<");
    expect(cap).toContain(">AI<");
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain("AI - Model");
  });

  // --- criterion 4 -----------------------------------------------------------

  test("with no model configured there is no picker and no caption words", () => {
    const html = rows([], [target("123-picks")], { modelChoices: undefined });
    expect(controlsLine(html, "123-picks")).not.toBe("");
    expect(html).not.toContain("<select");
    // The line itself is still drawn — it carries the row's one action
    // since 2026-09-08 — but it heads nothing: no captions, because
    // there is nothing to choose between.
    expect(caption(html)).not.toContain(">Phase<");
    expect(caption(html)).not.toContain(">Model<");
    expect(html).not.toContain(">Phase<");
  });

  // --- criterion 11 ----------------------------------------------------------

  // "last ran: X" is not spelled out any more (asked for 2026-08-19) —
  // the select's pre-filled value IS the answer.
  test("a phase that has run pre-fills its select with the model it ran on", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" })],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).not.toContain("last ran");
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("a phase run more than once keeps its attempt count", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
        row({ id: "j2", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" }),
      ],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).toContain("2 attempts");
    expect(line).toContain('<select name="model.analyze"');
  });

  // Spec 176, criterion 4: the note used to sit in a `<div>` of its
  // own under the badge, so a phase line that had one was taller than
  // a phase line that had not — and everything beside it moved. It
  // rides on the badge's own line now.
  test("the attempt count rides beside the badge, not on a line of its own (spec 176)", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
        row({ id: "j2", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" }),
      ],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).not.toContain("<div class=\"muted small\">");
    // The count is IN the badge since 2026-09-08 — "done (2)", with the
    // word in the pill's own title. Two marks for one fact read as two
    // facts, and the pill is where the phase's state is said.
    expect(line).toMatch(/<span class="badge b-[a-z]+" title="2 attempts">[a-z]+ \(2\)<\/span>/);
  });

  // --- the gap the description asked to close --------------------------------

  test("nothing sits between the phase name and its picker", () => {
    const line = subRow(rows([]), "analyze");
    // The two shared one cell from spec 123 until spec 165 gave each a
    // real column of its own — with the row's AI between them, which
    // is the choice that comes first. What the gap was for is still
    // gone: no empty column stands between the name and the model.
    // `analyze` is not the first phase line, so the AI column's slot
    // here is the first line's `rowspan` and no cell of its own
    // stands between the two.
    expect(line).toMatch(/<td class="phasecell">[\s\S]*?<\/td><td class="modelcell">/);
    expect(line).toContain('<select name="model.analyze"');
  });

  // --- the lock spec 105 put on the shared field follows it here -------------

  test("a busy spec's phase pickers lock exactly as the shared one did", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).toContain("disabled");
    expect(select).toContain('title="implement is running"');
  });

  test("a settled spec's phase pickers are live again", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "done" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).not.toContain("disabled");
  });

  // A collapsed row has no phase lines, so it has no picker either —
  // the same promise spec 103 made about the shared field.
  test("a collapsed row offers no picker", () => {
    const html = rows([], [target("123-picks")], { filter: {} });
    expect(html).not.toContain("<select");
    expect(html).not.toContain('<tr class="subrow');
  });

  // --- spec 308: a model picked for a phase survives leaving the page --------

  // REQ-2: a phase nobody has run yet, but that a reader picked a model
  // for on an earlier visit, pre-fills from that recorded pick rather
  // than falling straight to the configured default.
  test("REQ-2: a phase with a recorded pending choice pre-fills from it", () => {
    const line = subRow(
      rows([], [target("123-picks")], {
        defaultModels: { default: "sonnet" },
        pendingModels: { "aide/123-picks": { analyze: "fable" } },
      }),
      "analyze",
    );
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  // REQ-5: a phase nobody has ever picked a model for shows the
  // configured default exactly as before this change.
  test("REQ-5: a phase with no recorded pick still shows the configured default", () => {
    const line = subRow(
      rows([], [target("123-picks")], {
        defaultModels: { default: "sonnet" },
        pendingModels: { "aide/123-picks": { implement: "fable" } },
      }),
      "analyze",
    );
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // REQ-4: once a phase has actually run, what it ran on wins over any
  // earlier pending pick — a record of what happened outranks a choice
  // about what is to come.
  test("REQ-4: a phase that has since run shows what it ran on, not the earlier pending pick", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" })],
      [target("123-picks", { done: ["analyze"] })],
      { pendingModels: { "aide/123-picks": { analyze: "fable" } } },
    );
    const line = subRow(html, "analyze");
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
  });
});

// --- spec 342: a picker drawn for a spec that does not exist yet -------------
//
// The New spec page has no real project/specFolder to derive a form id
// from (`runFormId(g)` reads both off `g`), so `aiPicker`/`modelPicker`
// take an optional override that replaces it — and nothing else the two
// functions draw.
describe("spec 342: formIdOverride replaces the derived form id", () => {
  const models = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12, tool: "codex" as const },
  ];
  const g: SpecGroup = {
    project: "", specFolder: "new", named: false, state: "not-started",
    spentUsd: 0, costUnmeasured: false, phases: [], done: [], dependsOn: [], analyzeStale: false,
  };
  const opts: PickerOptions = { modelChoices: models };

  test("modelPicker posts to the override, not the derived id", () => {
    const html = modelPicker(g, opts, "create", false, false, undefined, undefined, "new-spec-form");
    expect(html).toContain('form="new-spec-form"');
    expect(html).not.toContain("rowrun-");
  });

  test("aiPicker posts to the override too", () => {
    const html = aiPicker(g, opts, "create", false, false, undefined, undefined, "new-spec-form");
    expect(html).toContain('form="new-spec-form"');
    expect(html).not.toContain("rowrun-");
  });

  // Every existing caller in `phase-rows.ts` passes no override at all,
  // and has to keep reading exactly as it did before this parameter
  // existed.
  test("omitted, the two fall back to the derived id exactly as before", () => {
    const withFolder: SpecGroup = { ...g, project: "aide", specFolder: "81-queue-and-runner" };
    expect(modelPicker(withFolder, opts, "create", false, false)).toContain(
      'form="rowrun-aide/81-queue-and-runner"',
    );
    expect(aiPicker(withFolder, opts, "create", false, false)).toContain(
      'form="rowrun-aide/81-queue-and-runner"',
    );
  });


});

// The point of the name is that a reader SEES it: a row running the
// scripted stand-in must not read as a real Claude run. `TOOL_NAMES` has
// carried "Fake-Claude" all along; what was missing was a rendered page
// proving the word reaches one — the round's own config named no tool,
// so its rows read as Claude Code over runs no Claude ever touched.
describe("a row running the scripted stand-in says so", () => {
  const TARGET: QueueTarget = { project: "aide", specFolder: "123-picks" };
  const render = (modelChoices: QueuePageOptions["modelChoices"]): string =>
    renderQueueRows(
      [],
      { runnerAvailable: true, targets: [TARGET], modelChoices, filter: { open: openKeys([], [TARGET]) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  test("the page names it Fake-Claude, not Claude Code", () => {
    const html = render([{ name: "script", budgetUsd: 1, tool: "fake-claude" }]);
    expect(html).toContain("Fake-Claude");
    expect(html).not.toContain("Claude Code");
  });

  test("a choice that names no tool still reads as Claude Code", () => {
    const html = render([{ name: "sonnet", budgetUsd: 3 }]);
    expect(html).not.toContain("Fake-Claude");
  });
});
