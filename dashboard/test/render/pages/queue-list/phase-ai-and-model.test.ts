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
