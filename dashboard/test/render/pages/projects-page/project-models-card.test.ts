// The rows of a project's Models per phase card: Settings → Models per
// phase's own steps and parts, each resting on Board default until the
// project sets its own choice.

import { describe, expect, test } from "bun:test";
import { projectModelRows } from "../../../../src/render/pages/projects-page/project-models.ts";
import type { QueueDefaults } from "../../../../src/queue/types.ts";

const BOARD: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Haiku", implement: "Opus" },
  modelChoices: { Opus: {}, Sonnet: {}, Haiku: {} },
  provider: { implement: "claude-max" },
  projectModels: { woodstack: { model: { analyze: "Sonnet" }, provider: { analyze: "claude-max" } } },
};

describe("the Models per phase card's rows", () => {
  test("are Settings' steps and parts, in Settings' order (AC-1)", () => {
    expect(projectModelRows(BOARD, "woodstack").map((r) => r.step)).toEqual([
      "create", "analyze", "plan-review", "implement", "review", "verify", "archive", "close", "reopen", "schedule",
    ]);
  });

  test("a step the project does not set rests on Board default; one it sets shows its own choice (AC-2)", () => {
    const rows = Object.fromEntries(projectModelRows(BOARD, "woodstack").map((r) => [r.step, r]));
    expect(rows.implement!.own).toBeUndefined();
    expect(rows.implement!.boardDefault).toBeDefined();
    expect(rows.analyze!.own).toEqual({ model: "Sonnet", provider: "claude-max" });
  });
});
