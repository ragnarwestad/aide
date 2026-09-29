import { describe, expect, test } from "bun:test";
import { OTHER_STEPS, renderSettingsPage, settingsRowChoice, SETTINGS_STEPS, SPEC_STEPS, UNROWED_STEPS } from "../../../src/render";
import { WORKFLOW_STEPS } from "../../../src/queue/steps.ts";
import { mergeQueueDefaults } from "../../../src/queue/queue.ts";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers";

const MODELS = [
  { name: "sonnet", tool: "claude" as const },
  { name: "opus", tool: "claude" as const },
  { name: "codex-fast", tool: "codex" as const },
];

const TIMEOUT_SEC = { default: 1200, implement: 5400 };

describe("Settings page", () => {
  // The rows still come FROM the canonical step list rather than a
  // hand-picked copy of it — but now through two groups plus a named
  // set of steps that deliberately get no row, so a step added to
  // workflow-steps.json still cannot end up silently without one.
  test("every workflow step is grouped or named unrowed", () => {
    const covered = [...SPEC_STEPS, ...OTHER_STEPS, ...UNROWED_STEPS];
    expect([...covered].sort()).toEqual([...WORKFLOW_STEPS].sort());
  });

  test("the two groups are exactly the rows, in order", () => {
    expect(SETTINGS_STEPS).toEqual([...SPEC_STEPS, ...OTHER_STEPS]);
  });

  test("explore gets no row: nothing on the board starts it", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    expect(html).not.toContain('data-step="explore"');
  });

  test("the rows are the steps and nothing else: no Fallback row (AC-2)", () => {
    const html = renderSettingsPage([], "2026-08-24T00:00:00Z", {
      modelChoices: MODELS, defaultModels: { default: "sonnet" }, timeoutSec: TIMEOUT_SEC,
    });
    const rows = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual([...SETTINGS_STEPS]);
  });
});

describe("what a Settings row shows", () => {
  // As the page receives them from the serving host: capitalised, and not
  // with Opus first, so a name that fails to match shows up as Fable.
  const HOST_MODELS = [
    { name: "Fable", tool: "claude" as const },
    { name: "Opus", tool: "claude" as const },
    { name: "Sonnet", tool: "claude" as const },
    { name: "codex-fast", tool: "codex" as const },
  ];
  const listed = { Fable: {}, Opus: {}, Sonnet: {}, "codex-fast": { tool: "codex" } };

  test("a row nothing was saved for shows Claude Code and Opus (AC-3)", () => {
    const { model } = mergeQueueDefaults(QUEUE_DEFAULTS, { modelChoices: listed });
    for (const step of SETTINGS_STEPS) {
      expect(settingsRowChoice(HOST_MODELS, model, step)).toEqual({ model: "Opus", tool: "claude" });
    }
  });

  test("a step's own saved choice is what its row shows (AC-4)", () => {
    const { model } = mergeQueueDefaults(QUEUE_DEFAULTS, {
      modelChoices: listed, model: { implement: "codex-fast" },
    });
    expect(settingsRowChoice(HOST_MODELS, model, "implement")).toEqual({ model: "codex-fast", tool: "codex" });
    expect(settingsRowChoice(HOST_MODELS, model, "analyze")).toEqual({ model: "Opus", tool: "claude" });
  });
});
