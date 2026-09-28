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
  const phaseSelect = (html: string, step: string) =>
    html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";

  // --- criterion 1 -----------------------------------------------------------

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

  // --- criterion 7: the model selects stand on their own --------------------

  // --- criterion 8 -----------------------------------------------------------

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
    // Spec 454: the reason is not the select's own `title`.
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

  // --- spec 308: resolveChosenModel's new "pending" tier ---------------------

  // A pending pick wins over the configured default, exactly as a phase
  // with history wins over a pending pick (`used` > `pending` >
  // `configured`, tested end to end in phase-model-picker.test.ts).
  test("a recorded pending pick beats the configured default", () => {
    const html = rows([], {
      defaultModels: { default: "sonnet" },
      pendingModels: { "aide/169-one-picker": { analyze: "gpt-fast" } },
    });
    expect(phaseSelect(html, "analyze")).toMatch(/<option value="gpt-fast"[^>]*selected/);
  });

  // An absent pending value for one step falls through to the
  // configured default unchanged — the boundary case immediately
  // beneath the new tier.
  test("an absent pending pick falls through to the configured default unchanged", () => {
    const html = rows([], {
      defaultModels: { default: "sonnet" },
      pendingModels: { "aide/169-one-picker": { implement: "gpt-fast" } },
    });
    expect(phaseSelect(html, "analyze")).toMatch(/<option value="sonnet"[^>]*selected/);
  });
});

// A phase that has run shows what it ran on, whatever the choices are
// called today. Renaming the entries in queue-config.json (2026-09-15)
// made every finished phase on an active row fall back to the default,
// because the job's choice name no longer matched an entry — while the
// phase's own file still named the model.
import { resolveChosenModel } from "../../../../../src/render/pages/specs-list";
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
