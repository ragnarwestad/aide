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
import { TOOL_ICONS } from "../../../../../src/render/ui/components/icons.ts";

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

  test("a provider the step ran on that was removed stays shown, not replaced by another of its tool (AC-10)", () => {
    const list = [row({ specFolder: "179-ai-per-phase", state: "done", stepProviders: { analyze: "removed-one" } })];
    const select = aiSelect(rows(list), "analyze");
    expect(select).toMatch(/<option value="removed-one"[^>]*selected>removed-one</);
    expect(select).not.toMatch(/<option value="Claude"[^>]*selected/);
  });

  // --- The closed picker: the tool's icon and the short name -------

  /** The picker a phase line draws: the face and the select it lies over. */
  const pick = (html: string, step: string) =>
    html.match(new RegExp(`<span class="providerpick">(?:(?!<span class="providerpick">)[\\s\\S])*?data-ai="model\\.${step}"[\\s\\S]*?</select></span>`))?.[0] ?? "";
  const face = (picker: string) => picker.slice(0, picker.indexOf("<select"));

  test("the closed picker shows the chosen provider's tool icon and short name, every option keeping its full name (AC-5, AC-6)", () => {
    const PERSONAL = { key: "personal", name: "Claude Personal", short: "CP", tool: "claude" as const };
    const html = rows([], { modelChoices: BOTH, providerChoices: [PERSONAL, { ...CODEX, short: "CO" }] });
    for (const step of STEPS) {
      const picker = pick(html, step);
      expect([step, face(picker).includes(TOOL_ICONS.claude)]).toEqual([step, true]);
      expect([step, face(picker).includes(">CP<")]).toEqual([step, true]);
      expect([step, face(picker).includes("Claude Personal")]).toEqual([step, false]);
    }
    const select = aiSelect(html, "analyze");
    expect(select).toMatch(/<option value="personal" data-tool="claude"[^>]*data-short="CP"[^>]*>Claude Personal</);
    expect(select).toMatch(/<option value="Codex" data-tool="codex"[^>]*data-short="CO"[^>]*>Codex</);
  });

  test("a provider with no short name is shown by one made from its name (AC-5)", () => {
    expect(face(pick(rows(), "analyze"))).toContain(">CL<");
  });

  test("a removed provider the step ran on is shown by its key's letters and the icon of the tool its model runs on (AC-5)", () => {
    const list = [row({ specFolder: "179-ai-per-phase", state: "done", model: "gpt-fast", stepProviders: { analyze: "removed-one" } })];
    const picker = pick(rows(list), "analyze");
    expect(face(picker)).toContain(">RO<");
    expect(face(picker)).toContain(TOOL_ICONS.codex);
  });

  test("the closed picker carries the chosen provider's full name as its hover text and accessible name (AC-7)", () => {
    const PERSONAL = { key: "personal", name: "Claude Personal", short: "CP", tool: "claude" as const };
    const select = aiSelect(rows([], { providerChoices: [PERSONAL, CODEX] }), "analyze");
    expect(select).toMatch(/^<select[^>]* title="Claude Personal"/);
    expect(select).toMatch(/^<select[^>]* aria-label="Claude Personal"/);
  });
});

// --- The closed button and the selects inside it agree ------------------
//
// The row is drawn whole, and the button's model, short name and tool mark
// are read off the same line as the option each select marks `selected`
// and the face laid over the AI select. A row that handed the button other
// facts than the selects would disagree here.
describe("the AI/model button shows what the selects inside it show", () => {
  const CLAUDE = { key: "Claude", name: "Claude", tool: "claude" as const };
  const CODEX = { key: "Codex", name: "Codex", tool: "codex" as const };
  const MODELS = [{ name: "sonnet" }, { name: "fable" }, { name: "gpt-fast", tool: "codex" as const }];
  const FOLDER = "842-agree";
  const KEY = `aide/${FOLDER}`;

  const draw = (list: QueueRowView[], opts: Partial<SpecsPageOptions> = {}) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: FOLDER }],
        modelChoices: MODELS,
        providerChoices: [CLAUDE, CODEX],
        filter: { open: KEY },
        ...opts,
      },
      Date.parse("2026-11-21T12:00:00Z"),
    );

  const iconOf = (face: string): string =>
    (Object.keys(TOOL_ICONS) as (keyof typeof TOOL_ICONS)[]).find((k) => face.includes(TOOL_ICONS[k])) ?? "none";
  const shortIn = (face: string) => face.match(/providershort">([^<]*)</)?.[1];

  /** What one phase line's button and selects each show. */
  function shown(html: string, step: string) {
    const line = html.match(new RegExp(`<tr class="subrow" data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? "";
    const button = line.match(/class="aimodelnow"[\s\S]*?<span class="aimodelshort">([^<]*)<\/span>/);
    const panel = line.slice(line.indexOf('class="aimodelpanel"'));
    const pickFace = panel.slice(0, panel.indexOf("<select"));
    return {
      button: { model: button?.[1], short: shortIn(button?.[0] ?? ""), icon: iconOf(button?.[0] ?? "") },
      selects: {
        model: panel.match(/<select name="model\.[^"]*"[\s\S]*?<option value="([^"]*)"[^>]*selected/)?.[1],
        short: shortIn(pickFace),
        icon: iconOf(pickFace),
      },
    };
  }

  const running = (extra: Partial<QueueRowView> = {}) =>
    row({
      id: "j1", specFolder: FOLDER, steps: ["analyze", "implement", "archive"], stepIndex: 0,
      state: "running", editableSteps: ["implement", "archive"], ...extra,
    });

  test("a running job's own pick on a step it has not reached shows on the button and in the selects (AC-8)", () => {
    const html = draw([running({ stepModels: { archive: "gpt-fast" }, stepProviders: { archive: "Codex" } })]);
    const { button, selects } = shown(html, "archive");
    expect(selects).toEqual({ model: "gpt-fast", short: "CO", icon: "codex" });
    expect(button).toEqual(selects);
  });

  test("with no pick on the job, the button and the selects show the spec's pending pick (AC-8)", () => {
    const html = draw([running()], { pendingModels: { [KEY]: { archive: "fable" } } });
    const { button, selects } = shown(html, "archive");
    expect(selects).toEqual({ model: "fable", short: "CL", icon: "claude" });
    expect(button).toEqual(selects);
  });

  const archived = (over: Record<string, unknown> = {}) => ({
    project: "aide",
    folder: FOLDER,
    done: ["create", "analyze", "implement", "archive"],
    models: { analyze: "claude fable", archive: "claude fable" },
    phaseOutcomes: {},
    ...over,
  });
  const drawArchived = (spec: ReturnType<typeof archived>, list: QueueRowView[] = [], opts: Partial<SpecsPageOptions> = {}) =>
    draw(list, { targets: [], archivedSpecs: [spec], filter: { state: "archived", open: KEY }, ...opts });

  test("an archived row offering Archive again shows the Archive pick on its button and selects, its record elsewhere (AC-9)", () => {
    const html = drawArchived(archived({ notLanded: true }), [], {
      pendingModels: { [KEY]: { archive: "gpt-fast", analyze: "gpt-fast" } },
    });
    const archive = shown(html, "archive");
    expect(archive.selects).toEqual({ model: "gpt-fast", short: "CO", icon: "codex" });
    expect(archive.button).toEqual(archive.selects);
    const analyze = shown(html, "analyze");
    expect(analyze.selects.model).toBe("fable");
    expect(analyze.button).toEqual(analyze.selects);
  });

  test("a phase locked as an archived record shows its recorded model and provider, pending picks ignored (AC-10)", () => {
    const html = drawArchived(archived(), [], { pendingModels: { [KEY]: { analyze: "gpt-fast" } } });
    const { button, selects } = shown(html, "analyze");
    expect(selects).toEqual({ model: "fable", short: "CL", icon: "claude" });
    expect(button).toEqual(selects);
  });

  test("a locked phase whose recorded model is no longer configured shows the recorded tool on both (AC-10)", () => {
    const job = row({
      id: "j9", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "done", model: "old-codex",
      stepProviders: { analyze: "Codex" },
      results: [{ step: "analyze", ok: true, costUsd: 0, tool: "codex" }],
    });
    const html = drawArchived(archived({ models: { analyze: "codex old-codex" } }), [job]);
    const { button, selects } = shown(html, "analyze");
    expect(selects).toEqual({ model: "old-codex", short: "CO", icon: "codex" });
    expect(button).toEqual(selects);
  });

  const removedRun = (tool: "codex" | "none") =>
    row({
      id: "j2", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "done", model: "old-model",
      stepProviders: { analyze: "removed-one" },
      results: [{ step: "analyze", ok: true, costUsd: 0, tool }],
    });

  test("a removed provider is named by its recorded key on both, with the recorded tool's mark (AC-11)", () => {
    const { button, selects } = shown(draw([removedRun("codex")]), "analyze");
    expect(selects).toEqual({ model: "old-model", short: "RO", icon: "codex" });
    expect(button).toEqual(selects);
    expect(draw([removedRun("codex")])).toMatch(/<option value="removed-one"[^>]*selected>removed-one</);
  });

  test("a removed provider whose recorded tool is none shows no tool mark on either (AC-11)", () => {
    const { button, selects } = shown(draw([removedRun("none")]), "analyze");
    expect(selects).toEqual({ model: "old-model", short: "RO", icon: "none" });
    expect(button).toEqual(selects);
  });
});
