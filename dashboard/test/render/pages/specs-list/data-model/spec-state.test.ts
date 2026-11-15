import { describe, expect, test } from "bun:test";
import { specState } from "../../../../../src/render/pages/specs-list/data-model/spec-state.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";

const group = (extra: Partial<SpecGroup> = {}) => ({
  state: "not-started",
  done: [],
  ...extra,
} as SpecGroup);

describe("a spec's own state", () => {
  test("shows Created before any job and Idle after settled work (AC-1, AC-2, AC-4)", () => {
    expect(specState(group()).key).toBe("created");
    expect(specState(group({ reopenedRound: true })).key).toBe("reopened");
    expect(specState(group({ done: ["analyze"] })).key).toBe("idle");
    expect(specState(group({ done: ["analyze", "implement"] })).key).toBe("idle");
    expect(specState(group({ state: "archived" })).key).toBe("archived");
    expect(specState(group({ state: "closed" })).key).toBe("closed");
  });

  test("names queued, running and landing work Active with its phase (AC-3)", () => {
    const lead = { state: "running", steps: ["implement"], stepIndex: 0 } as SpecGroup["lead"];
    for (const state of ["queued", "running"] as const)
      expect(specState(group({ done: ["analyze"], lead: { ...lead!, state } }))).toEqual({ key: "active", phase: "implement" });
    expect(specState(group({ done: ["analyze"], lead: { ...lead!, state: "done" } }))).toEqual({ key: "idle" });
    expect(specState(group({ state: "archived", lead: { ...lead!, state: "done", landing: true } })))
      .toEqual({ key: "active", phase: "implement" });
  });
});
