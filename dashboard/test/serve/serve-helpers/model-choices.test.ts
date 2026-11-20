import { describe, expect, test } from "bun:test";
import { modelChoiceOptions, modelsInUse } from "../../../src/serve/serve-helpers";

const queue = (modelChoices: Record<string, { tool?: "claude" | "codex" | "opencode" | "fake-claude" }>, modelIds: Record<string, string>) =>
  ({ defaults: { modelChoices }, modelIds }) as Parameters<typeof modelChoiceOptions>[0];

describe("the option array the model pickers are built from", () => {
  test("a Claude alias that has run carries the id its newest run reported", () => {
    const options = modelChoiceOptions(queue({ Opus: {}, Sonnet: { tool: "claude" } }, { Opus: "claude-opus-5-5", Sonnet: "claude-sonnet-5" }));
    expect(options).toEqual([
      { name: "Opus", ranAs: "claude-opus-5-5" },
      { name: "Sonnet", tool: "claude", ranAs: "claude-sonnet-5" },
    ]);
  });

  test("an alias that has never run, another tool's choice and a choice named by its id carry none", () => {
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

  test("offers only the newest configured Codex version in each family", () => {
    const choices = {
      "gpt-5.6-sol": { tool: "codex" as const },
      "gpt-6-sol": { tool: "codex" as const },
      "gpt-6.1-sol": { tool: "codex" as const },
      "gpt-6.2-sol": { tool: "codex" as const },
      "gpt-6.10-sol": { tool: "codex" as const },
      "gpt-6-astra": { tool: "codex" as const },
      "gpt-6-luna": { tool: "codex" as const },
      "gpt-6.1-terra": { tool: "codex" as const },
      "gpt-reserve": { tool: "codex" as const },
      "gpt-5.6-sol-experimental": { tool: "codex" as const },
      Opus: {},
    };
    expect(modelChoiceOptions(queue(choices, {})).map((m) => m.name)).toEqual([
      "gpt-6.10-sol", "gpt-6-astra", "gpt-6-luna", "gpt-6.1-terra",
      "gpt-reserve", "gpt-5.6-sol-experimental", "Opus",
    ]);
    expect(choices["gpt-5.6-sol"]).toEqual({ tool: "codex" });
  });

  test("compares the configured model ids even when choices have custom names", () => {
    const choices = {
      Previous: { tool: "codex" as const, model: "gpt-6-sol" },
      Current: { tool: "codex" as const, model: "gpt-6.1-sol" },
      OtherProvider: { tool: "opencode" as const, model: "gpt-5.6-sol" },
    };
    expect(modelChoiceOptions(queue(choices, {})).map((m) => m.name)).toEqual(["Current", "OtherProvider"]);
  });

  test("an older version something is set to stays offered, so its picker shows it under its own AI", () => {
    const choices = { "gpt-5.6-sol": { tool: "codex" as const }, "gpt-6.1-sol": { tool: "codex" as const } };
    const inUse = modelsInUse({
      queue: { defaults: { model: { analyze: "gpt-6.1-sol" } }, pendingModels: {} } as never,
      scheduleStore: { list: (project) => project === "aide" ? [{ name: "Untangle", cron: "0 6 * * *", prompt: "p.md", model: "gpt-5.6-sol", enabled: true }] : [] },
      allowed: new Set(["aide"]),
    });
    expect(modelChoiceOptions(queue(choices, {}), inUse).map((m) => m.name)).toEqual(["gpt-5.6-sol", "gpt-6.1-sol"]);
    expect(modelChoiceOptions(queue(choices, {})).map((m) => m.name)).toEqual(["gpt-6.1-sol"]);
  });

  test("a model picked for a phase that has not run counts as set", () => {
    const inUse = modelsInUse({
      queue: { defaults: {}, pendingModels: { "aide/90-x": { implement: "gpt-6-sol" } } } as never,
      scheduleStore: { list: () => [] },
      allowed: new Set(["aide"]),
    });
    expect([...inUse]).toEqual(["gpt-6-sol"]);
  });

  test("no configured choices is an empty list", () => {
    expect(modelChoiceOptions({ defaults: {}, modelIds: {} } as Parameters<typeof modelChoiceOptions>[0])).toEqual([]);
  });
});
