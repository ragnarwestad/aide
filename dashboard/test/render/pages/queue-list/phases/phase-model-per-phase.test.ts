// Split out of phase-controls-and-progress.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
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

  // One tool is still named. Hiding the AI column left the first select
  // on the line holding a MODEL under a heading a reader takes for the
  // AI — and a project running a scripted stand-in could not see from
  // the row that it was running one.
  test("one tool is named too, so the headings match the controls under them", () => {
    const cap = caption(rows([], { modelChoices: ONE_TOOL }));
    expect(cap).toContain(">Model<");
    expect(cap).toContain(">AI<");
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
