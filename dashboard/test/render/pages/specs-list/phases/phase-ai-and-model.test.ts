// Split out of phase-controls-and-progress.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../../../../src/render";
import {
  row,
  openKeys,
} from "../../fixtures.ts";

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
  const target = (specFolder = "179-ai-per-phase"): SpecTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet" },
    { name: "fable" },
    { name: "gpt-fast",  tool: "codex" as const },
  ];
  /** Codex FIRST, so a fallback that took `modelChoices`'s head can be
   *  told from one that took a literal "claude". */
  const CODEX_FIRST = [
    { name: "gpt-fast",  tool: "codex" as const },
    { name: "sonnet" },
  ];
  const ONE_TOOL = [
    { name: "sonnet" },
    { name: "fable" },
  ];

  const rows = (
    list: QueueRowView[] = [],
    opts: Partial<SpecsPageOptions> = {},
    targets: SpecTarget[] = [target()],
  ) =>
    renderSpecsRows(
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

  // --- criterion 1: one AI per phase, beside that phase's model ------------

  test("a tool with no model configured is not offered as an AI", () => {
    // The count that decides WHAT is offered is TOOLS, not models: one
    // configured tool draws one option, and a tool nothing is
    // configured for draws none. The control itself is drawn either
    // way — a heading with no control under it, or a model select under
    // a heading that says AI, is what hiding it produced.
    const html = rows([], { modelChoices: ONE_TOOL });
    for (const step of STEPS) {
      expect([step, aiSelect(html, step).includes(">Claude Code<")]).toEqual([step, true]);
      expect([step, aiSelect(html, step).includes(">Codex<")]).toEqual([step, false]);
    }
    // And the model selects beside it are untouched by any of it.
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

  // --- criterion 8: nothing new is posted ---------------------------------
});
