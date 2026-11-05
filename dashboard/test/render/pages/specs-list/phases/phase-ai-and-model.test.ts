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

// --- An AI and a model on every phase line -------------------------
//
// Every phase line carries a provider select of its own beside its model
// select. Choosing a provider for a phase fills in the model for that same
// phase, and nothing else on the row moves. The select posts
// `provider.<step>` beside `model.<step>`.
//
// Which model a provider stands for is answered HERE, where the
// configuration is, and carried into the markup on each option's
// `data-default`: the step's configured default when that default runs
// under the provider's tool, else the first entry `modelChoices` lists for
// it. The browser copies a value; it never chooses one.
describe("an AI and a model on every phase line", () => {
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
        providerChoices: [CLAUDE, CODEX],
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );

  const CLAUDE = { key: "Claude", name: "Claude", tool: "claude" as const };
  const CAPRA = { key: "capra", name: "Claude-Capra", tool: "claude" as const };
  const CODEX = { key: "Codex", name: "Codex", tool: "codex" as const };
  const STEPS = ["create", "analyze", "implement", "archive"];
  const aiSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select[^>]*data-ai="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";

  // --- One AI per phase, beside that phase's model ------------

  test("the select lists the providers it is given by name, and posts its key under provider.<step> (AC-9)", () => {
    const html = rows([], { modelChoices: ONE_TOOL, providerChoices: [CLAUDE, CAPRA] });
    for (const step of STEPS) {
      const select = aiSelect(html, step);
      expect([step, select.includes(`name="provider.${step}"`)]).toEqual([step, true]);
      expect([step, select.includes('<option value="capra"')]).toEqual([step, true]);
      expect([step, select.includes(">Claude-Capra<")]).toEqual([step, true]);
      expect([step, select.includes(">Codex<")]).toEqual([step, false]);
    }
    // And the model selects beside it are untouched by any of it.
    expect(html).toContain('<select name="model.analyze"');
  });

  test("no model configured at all, or no provider to list, draws no AI select either", () => {
    expect(rows([], { modelChoices: undefined })).not.toContain('data-ai="');
    expect(rows([], { providerChoices: [] })).not.toContain('data-ai="');
  });

  // --- The model an AI fills in is worked out here ------------

  test("each option carries the model its provider's tool fills in", () => {
    const select = aiSelect(rows(), "analyze");
    // The first entry `modelChoices` lists for that tool, in
    // configuration order — `fable` is a Claude model too and does not
    // lead.
    expect(select).toMatch(/<option value="Claude" data-tool="claude" data-default="sonnet"/);
    expect(select).toMatch(/<option value="Codex" data-tool="codex" data-default="gpt-fast"/);
  });

  test("a step's configured default is what its own tool fills in", () => {
    const html = rows([], { defaultModels: { analyze: "fable" } });
    // Configuration named a model for this step, and it is a Claude
    // one — so picking Claude Code gives it back rather than the
    // tool's first entry.
    expect(aiSelect(html, "analyze")).toMatch(/<option value="Claude" data-tool="claude" data-default="fable"/);
    // The other tool has no configured opinion, so it falls through.
    expect(aiSelect(html, "analyze")).toMatch(/<option value="Codex" data-tool="codex" data-default="gpt-fast"/);
    // And it is the STEP's default, not the row's: implement was not
    // named, so it keeps the tool's first entry.
    expect(aiSelect(html, "implement")).toMatch(/<option value="Claude" data-tool="claude" data-default="sonnet"/);
  });

  test("a configured default belonging to the other tool is left to that tool", () => {
    const html = rows([], { defaultModels: { default: "gpt-fast" } });
    const select = aiSelect(html, "analyze");
    expect(select).toMatch(/<option value="Codex" data-tool="codex" data-default="gpt-fast"/);
    expect(select).toMatch(/<option value="Claude" data-tool="claude" data-default="sonnet"/);
  });

  // --- the server half: the AI shown is the model's own ---------------------

  test("the AI shown is the tool of the model the phase is actually on", () => {
    const html = rows();
    // Nothing configured and nothing run: the model select falls back
    // to the first entry, and the AI select says whose it is.
    for (const step of STEPS) {
      expect([step, /<option value="Claude"[^>]*selected/.test(aiSelect(html, step))]).toEqual([step, true]);
      expect([step, /<option value="Codex"[^>]*selected/.test(aiSelect(html, step))]).toEqual([step, false]);
    }
    // Move the model, and the AI moves with it — the same fallback
    // decides both, so the two cannot disagree.
    const codexFirst = rows([], { modelChoices: CODEX_FIRST });
    expect(phaseSelect(codexFirst, "analyze")).toMatch(/<option value="gpt-fast"[^>]*selected/);
    expect(aiSelect(codexFirst, "analyze")).toMatch(/<option value="Codex"[^>]*selected/);
  });

  test("a phase that ran on the other tool says so, and its neighbours do not", () => {
    const html = rows([
      row({
        id: "j1", specFolder: "179-ai-per-phase", steps: ["implement"],
        stepIndex: 0, state: "done", model: "gpt-fast",
      }),
    ]);
    expect(aiSelect(html, "implement")).toMatch(/<option value="Codex"[^>]*selected/);
    expect(aiSelect(html, "analyze")).toMatch(/<option value="Claude"[^>]*selected/);
  });

  // --- Nothing new is posted ---------------------------------
});
