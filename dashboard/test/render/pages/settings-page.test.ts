import { describe, expect, test } from "bun:test";
import { OTHER_STEPS, renderSettingsPage, SETTINGS_STEPS, SPEC_STEPS, UNROWED_STEPS } from "../../../src/render";
import { WORKFLOW_STEPS } from "../../../src/queue/steps.ts";

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
});
