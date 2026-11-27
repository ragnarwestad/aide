// Split out of phase-controls-and-progress.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecTarget } from "../../../../../src/render";
import { row, pickerRowsAt } from "../../fixtures.ts";
import { phaseLine } from "../../../../../src/render/pages/specs-list/model-resolve.ts";
import { sidePickers } from "../../../../../src/render/pages/specs-list/model-picker";
import { analyzeRests } from "../../../../../src/render/pages/specs-list/phase-rows.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model";

// --- One picker per phase, AI and model together -------------------
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
// gone, and what is left here is the half that outlived it:
// every phase select offers every model, grouped
// by tool, hiding nothing, with the fallbacks that decide which one is
// pre-filled.
describe("one picker per phase", () => {
  const target = (specFolder = "169-one-picker"): SpecTarget => ({ project: "aide", specFolder });

  const BOTH = [
    { name: "sonnet" },
    { name: "fable" },
    { name: "gpt-fast",  tool: "codex" as const },
  ];
  /** Codex FIRST, so a fallback that took `modelChoices`'s head can be
   *  told from one that took the row's old resting tool. */
  const CODEX_FIRST = [
    { name: "gpt-fast",  tool: "codex" as const },
    { name: "sonnet" },
  ];

  const rows = pickerRowsAt("2026-08-21T12:00:00Z", {
    modelChoices: BOTH,
    providerChoices: [
      { key: "Claude", name: "Claude", tool: "claude" as const },
      { key: "Codex", name: "Codex", tool: "codex" as const },
    ],
  }, [target()]);

  const STEPS = ["create", "analyze", "implement", "archive"];
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";

  test("Review and Verify show Settings choices and per-spec overrides while offering every model (AC-1, AC-3, AC-4)", () => {
    const html = rows([], {
      defaultModels: { default: "sonnet", review: "fable" },
      pendingModels: { "aide/169-one-picker": { review: "gpt-fast" } },
    });
    expect(html).toContain('name="model.review"');
    expect(html).toContain('name="model.verify"');
    const review = html.match(/<tr class="subrow" data-side="review">[\s\S]*?<\/tr>/)?.[0] ?? "";
    const verify = html.match(/<tr class="subrow" data-side="verify">[\s\S]*?<\/tr>/)?.[0] ?? "";
    for (const model of ["sonnet", "fable", "gpt-fast"]) expect(review).toContain(`value="${model}"`);
    expect(review).toMatch(/<option value="gpt-fast"[^>]*selected/);
    expect(verify).toMatch(/<option value="sonnet"[^>]*selected/);
    expect(review).not.toContain('<option value="">');
    expect(verify).not.toContain('<option value="">');
    expect(review).not.toContain("hidden disabled");
  });

  test("Review and Verify show the first listed model when the configured default is not listed (AC-3)", () => {
    const html = rows([], { modelChoices: [{ name: "Sonnet" }], defaultModels: { default: "opus" } });
    for (const part of ["review", "verify"]) {
      const side = html.match(new RegExp(`<tr class="subrow" data-side="${part}">[\\s\\S]*?<\\/tr>`))?.[0] ?? "";
      expect(side).toMatch(/<option value="Sonnet"[^>]*selected/);
    }
  });

  test("side pickers do not follow a running job's edited Implement tool (AC-2)", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["analyze", "implement"], stepIndex: 0, state: "running", model: "sonnet", stepModels: { analyze: "sonnet", implement: "gpt-fast" } }),
    ]);
    const review = html.match(/<tr class="subrow" data-side="review">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(review).toContain('value="gpt-fast"');
    expect(review).toContain('value="sonnet" data-tool="claude"');
    expect(review).not.toContain("hidden disabled");
  });

  test("a locked Review or Verify line shows what its job was given, not today's settings", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "running", model: "sonnet",
        stepModels: { implement: "sonnet", review: "fable", verify: "sonnet" }, stepProviders: { review: "Claude", verify: "Claude" } }),
    ], { defaultModels: { default: "gpt-fast", review: "gpt-fast", verify: "gpt-fast" } });
    const line = (part: string) => html.match(new RegExp(`<tr class="subrow" data-side="${part}">[\\s\\S]*?<\\/tr>`))?.[0] ?? "";
    expect(line("review")).toMatch(/<option value="fable"[^>]*selected/);
    expect(line("verify")).toMatch(/<option value="sonnet"[^>]*selected/);
    expect(line("review")).toMatch(/<option value="Claude"[^>]*selected/);
  });

  const sideLine = (html: string, part: string) =>
    html.match(new RegExp(`<tr class="subrow" data-side="${part}">[\\s\\S]*?<\\/tr>`))?.[0] ?? "";
  const optionValues = (line: string, name: string) =>
    [...(line.match(new RegExp(`<select name="${name}"[\\s\\S]*?</select>`))?.[0] ?? "").matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);

  test("a Review line under Analyze offers the AI and model options Implement's Review line does (AC-1)", () => {
    const html = rows();
    const planReview = sideLine(html, "plan-review");
    const review = sideLine(html, "review");

    expect(html.indexOf('data-side="plan-review"')).toBeGreaterThan(html.indexOf('data-step="analyze"'));
    expect(html.indexOf('data-side="plan-review"')).toBeLessThan(html.indexOf('data-step="implement"'));
    expect(optionValues(planReview, "model.plan-review")).toEqual(optionValues(review, "model.review"));
    expect(optionValues(planReview, "provider.plan-review")).toEqual(optionValues(review, "provider.review"));
    expect(planReview).not.toContain('<option value="">');
  });

  test("with no pick of its own, the Review line under Analyze rests on what Analyze runs on next (AC-6)", () => {
    const html = rows([], {
      providerChoices: [
        { key: "Claude", name: "Claude", tool: "claude" as const },
        { key: "Claude-B", name: "Claude B", tool: "claude" as const },
        { key: "Codex", name: "Codex", tool: "codex" as const },
      ],
      defaultModels: { default: "sonnet", review: "gpt-fast" },
      pendingModels: { "aide/169-one-picker": { analyze: "fable" } },
      pendingProviders: { "aide/169-one-picker": { analyze: "Claude-B" } },
    });
    const planReview = sideLine(html, "plan-review");

    expect(planReview).toMatch(/<option value="fable"[^>]*selected/);
    expect(planReview).toMatch(/<option value="Claude-B"[^>]*selected/);
  });

  test("the Review line under Analyze is locked where Analyze's own choice is, and open while Analyze is still to come (AC-7)", () => {
    const selects = (line: string) => line.match(/<select [^>]*>/g) ?? [];
    const archived = renderSpecsRows([], {
      runnerAvailable: true,
      targets: [],
      modelChoices: BOTH,
      archivedSpecs: [{ project: "aide", folder: "169-one-picker", done: ["create", "analyze", "implement", "archive"], models: {}, phaseOutcomes: {} }],
      filter: { open: "aide/169-one-picker" },
    });
    const running = rows([row({ id: "j1", specFolder: "169-one-picker", steps: ["analyze"], stepIndex: 0, state: "running" })]);
    const toCome = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["create", "analyze"], stepIndex: 0, state: "running", editableSteps: ["analyze"] }),
    ]);

    expect(selects(sideLine(archived, "plan-review")).length).toBeGreaterThan(0);
    for (const select of selects(sideLine(archived, "plan-review"))) expect(select).toContain(" disabled");
    for (const select of selects(sideLine(running, "plan-review"))) expect(select).toContain(" disabled");
    expect(selects(sideLine(toCome, "plan-review")).length).toBeGreaterThan(0);
    for (const select of selects(sideLine(toCome, "plan-review"))) expect(select).not.toContain(" disabled");
  });

  // --- the server half: what a phase has already run on ---------------------

  // `used` is what pre-fills a select with the model its phase really
  // ran on, and `data-ran="1"` is that fact said to the browser. It was
  // "set all"'s scope, before the control was removed; it stays
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

  // --- The model selects stand on their own --------------------

  // The fallback for an unconfigured, never-run phase was biased toward
  // the row's "resting tool". There is no resting
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

  // --- the lock a busy row puts on every control on it ------

  test("a busy row locks its AI selects for the same reason as its models", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "running" }),
    ]);
    const control = html.match(/<select[^>]*data-ai[^>]*>/)![0];
    expect(control).toContain("disabled");
    // The reason is not the select's own `title`.
    expect(control).not.toContain('title="Implement is running"');
  });

  // Asked of `archive`, not of the first select on the page: `create` is
  // drawn ticked and disabled on every row, and its own AI select is
  // locked with it. What settling frees is a phase the row can still
  // run.
  test("a settled row's AI selects are live again", () => {
    const html = rows([
      row({ id: "j1", specFolder: "169-one-picker", steps: ["implement"], stepIndex: 0, state: "done" }),
    ]);
    expect(html.match(/<select[^>]*data-ai="model\.archive"[^>]*>/)![0]).not.toContain("disabled");
  });
});

// A phase that has run shows what it ran on, whatever the choices are
// called today. Renaming the entries in queue-config.json (2026-09-15)
// made every finished phase on an active row fall back to the default,
// because the job's choice name no longer matched an entry — while the
// phase's own file still named the model.
import { resolveChosenModel } from "../../../../../src/render/ui/ai-model";
describe("a phase that has run keeps what it ran on across a rename of the choices", () => {
  const models = [
    { name: "Sonnet" },
    { name: "gpt-5.6-sol",  tool: "codex" as const },
  ];
  test("a job's choice name that is still offered wins as before", () => {
    expect(resolveChosenModel(models, "Sonnet", "gpt-5.6-sol", undefined, "gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });
  test("a renamed-away choice name falls back to the model the file recorded", () => {
    expect(resolveChosenModel(models, "Sonnet", "codex-sol", undefined, "gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });
  test("with neither offered any more, the name it ran on stands as it is — never the default", () => {
    expect(resolveChosenModel(models, "Sonnet", "codex-sol", undefined, "codex-sol")).toBe("codex-sol");
    expect(resolveChosenModel(models, "Sonnet", "codex-sol")).toBe("codex-sol");
  });
  test("a phase that has not run still resolves pending, then the default", () => {
    expect(resolveChosenModel(models, "Sonnet", undefined, "gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(resolveChosenModel(models, "Sonnet", undefined)).toBe("Sonnet");
  });
});

// A project's own choice for a step stands between the spec's own pick and
// the board's Models per phase, and the line says when it is what it rests on.
describe("a line resting on the project's choice", () => {
  const g = { project: "woodstack", specFolder: "1-x", named: true } as SpecGroup;
  const base = {
    modelChoices: [{ name: "Opus" }, { name: "Sonnet" }, { name: "Haiku" }],
    providerChoices: [{ key: "claude-max", name: "Claude Max", tool: "claude" as const }],
    defaultModels: { default: "Opus", implement: "Opus" },
    defaultProviders: {},
    projectChoices: { woodstack: { model: { implement: "Sonnet", analyze: "Sonnet" }, provider: { implement: "claude-max" } } },
  };

  test("the Implement line is on the project's model and AI, and says it is the project's choice (AC-4)", () => {
    const line = phaseLine(g, base, "implement", { live: false });
    expect(line?.model).toBe("Sonnet");
    expect(line?.provider?.key).toBe("claude-max");
    expect(line?.fromProject).toBe(true);
  });

  test("the spec's own pending pick wins, and the line does not say it comes from the project (AC-4)", () => {
    const line = phaseLine(g, { ...base, pendingModels: { "woodstack/1-x": { implement: "Haiku" } } }, "implement", { live: false });
    expect(line?.model).toBe("Haiku");
    expect(line?.fromProject).toBeFalsy();
  });

  test("another project's line is on the board's choice (AC-4)", () => {
    const line = phaseLine({ ...g, project: "aide" }, base, "implement", { live: false });
    expect(line?.model).toBe("Opus");
    expect(line?.fromProject).toBeFalsy();
  });

  test("Review under Analyze follows the project's Analyze as the project's choice (AC-4)", () => {
    const html = sidePickers(g, base, "plan-review", false, undefined, undefined, analyzeRests(g, base));
    expect(html).toContain('data-project-model="Sonnet"');
  });

  test("a board's own Review under Analyze wins over following, and is not the project's (AC-4)", () => {
    const board = { ...base, defaultModels: { ...base.defaultModels, "plan-review": "Haiku" } };
    const html = sidePickers(g, board, "plan-review", false, undefined, undefined, analyzeRests(g, board));
    expect(html).toMatch(/value="Haiku"[^>]*selected/);
    expect(html).not.toContain("data-project-model");
  });
});
