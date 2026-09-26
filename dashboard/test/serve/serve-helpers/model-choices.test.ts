import { describe, expect, test } from "bun:test";
import { modelChoiceOptions } from "../../../src/serve/serve-helpers/model-choices.ts";

const queue = (modelChoices: Record<string, { tool?: "claude" | "codex" | "opencode" | "fake-claude" }>, modelIds: Record<string, string>) =>
  ({ defaults: { modelChoices }, modelIds }) as Parameters<typeof modelChoiceOptions>[0];

describe("the option array the model pickers are built from", () => {
  test("a Claude alias that has run carries the id its newest run reported (AC-4)", () => {
    const options = modelChoiceOptions(queue({ Opus: {}, Sonnet: { tool: "claude" } }, { Opus: "claude-opus-5-5", Sonnet: "claude-sonnet-5" }));
    expect(options).toEqual([
      { name: "Opus", ranAs: "claude-opus-5-5" },
      { name: "Sonnet", tool: "claude", ranAs: "claude-sonnet-5" },
    ]);
  });

  test("an alias that has never run, another tool's choice and a choice named by its id carry none (AC-4)", () => {
    const options = modelChoiceOptions(
      queue(
        { Fable: {}, "gpt-6-sol": { tool: "codex" }, "claude-opus-4-1": {}, Stand: { tool: "fake-claude" } },
        { "gpt-6-sol": "x", "claude-opus-4-1": "claude-opus-4-1", Stand: "y" },
      ),
    );
    expect(options).toEqual([
      { name: "Fable" },
      { name: "gpt-6-sol", tool: "codex" },
      { name: "claude-opus-4-1" },
      { name: "Stand", tool: "fake-claude" },
    ]);
  });

  test("no configured choices is an empty list", () => {
    expect(modelChoiceOptions({ defaults: {}, modelIds: {} } as Parameters<typeof modelChoiceOptions>[0])).toEqual([]);
  });
});
