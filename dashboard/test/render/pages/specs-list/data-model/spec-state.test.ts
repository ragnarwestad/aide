import { describe, expect, test } from "bun:test";
import { specState, specStateLabel } from "../../../../../src/render/pages/specs-list/data-model/spec-state.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";

const group = (extra: Partial<SpecGroup> = {}) => ({
  state: "not-started",
  done: [],
  ...extra,
} as SpecGroup);

describe("a spec's own state", () => {
  test("comes from its completed phases, reopening, or final record (AC-1, AC-2, AC-3, AC-4, AC-5)", () => {
    expect(specState(group()).key).toBe("created");
    expect(specState(group({ reopenedRound: true })).key).toBe("reopened");
    expect(specState(group({ done: ["analyze"] })).key).toBe("analyzed");
    expect(specState(group({ done: ["analyze", "implement"] })).key).toBe("implemented");
    expect(specState(group({ state: "archived" })).key).toBe("archived");
    expect(specState(group({ state: "closed" })).key).toBe("closed");
  });

  test("names the active phase and returns to file-backed progress afterward (AC-6, AC-7, AC-8)", () => {
    const lead = { state: "running", steps: ["implement"], stepIndex: 0 } as SpecGroup["lead"];
    expect(specState(group({ done: ["analyze"], lead }))).toEqual({ key: "running", phase: "implement" });
    for (const state of ["queued", "stopped", "failed", "cancelled", "interrupted", "done"] as const) {
      expect(specState(group({ done: ["analyze"], lead: { ...lead!, state } }))).toEqual({ key: "analyzed" });
    }
    expect(specState(group({ state: "archived", lead: { ...lead!, state: "done", landing: true } })))
      .toEqual({ key: "running", phase: "implement" });
  });
});

test("Jobs names what is happening while Specs shows only Active", () => {
  for (const [phase, word] of [["analyze", "Analyzing"], ["implement", "Implementing"], ["archive", "Archiving"]]) {
    const state = { key: "running" as const, phase };
    expect(specStateLabel(state, "en", false)).toBe(word!);
    expect(specStateLabel(state, "en", true)).toBe("Active");
  }
});
