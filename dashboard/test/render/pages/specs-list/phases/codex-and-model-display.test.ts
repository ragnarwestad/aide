import { describe, expect, test } from "bun:test";
import { compactModelLabel, compactModelLabelFull } from "../../../../../src/render/pages/specs-list/model-resolve.ts";

// AC-1/AC-2 (spec 480): the compact button's own text — a bare model
// name by default, a tool prefix only on a name collision within the
// SAME configured array.
describe("compactModelLabel() names the phase's model (spec 480)", () => {
  test("the bare model name, when nothing else configured shares it", () => {
    const models = [{ name: "sonnet" }, { name: "gpt-fast", tool: "codex" as const }];
    expect(compactModelLabel(models, { model: "sonnet", tool: "claude" })).toBe("sonnet");
  });

  test("the short tool name in front, when two entries share the model name", () => {
    const models = [
      { name: "gpt-6", tool: "claude" as const },
      { name: "gpt-6", tool: "codex" as const },
    ];
    expect(compactModelLabel(models, { model: "gpt-6", tool: "codex" })).toBe("Codex · gpt-6");
  });

  test("empty when the phase is on nothing", () => {
    expect(compactModelLabel([{ name: "sonnet" }], undefined)).toBe("");
  });
});

// AC-1 (spec 488): the button's growing FULL text — always tool-prefixed,
// unlike compactModelLabel()'s own collision-only rule.
describe("compactModelLabelFull() always names the tool ahead of the model (spec 488)", () => {
  test("tool-prefixed even when nothing else configured shares the model's name", () => {
    const models = [{ name: "sonnet" }, { name: "gpt-fast", tool: "codex" as const }];
    expect(compactModelLabelFull(models, { model: "sonnet", tool: "claude" })).toBe("Claude · sonnet");
  });

  test("the same tool-prefixed text a collision already forces on compactModelLabel()", () => {
    const models = [
      { name: "gpt-6", tool: "claude" as const },
      { name: "gpt-6", tool: "codex" as const },
    ];
    expect(compactModelLabelFull(models, { model: "gpt-6", tool: "codex" })).toBe("Codex · gpt-6");
    expect(compactModelLabelFull(models, { model: "gpt-6", tool: "codex" })).toBe(
      compactModelLabel(models, { model: "gpt-6", tool: "codex" }),
    );
  });

  test("empty when the phase is on nothing", () => {
    expect(compactModelLabelFull([{ name: "sonnet" }], undefined)).toBe("");
  });
});
