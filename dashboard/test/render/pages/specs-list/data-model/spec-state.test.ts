import { describe, expect, test } from "bun:test";
import { specState, specStateLabel } from "../../../../../src/render/pages/specs-list/data-model/spec-state.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";
import { groupBySpec, applyFilter } from "../../../../../src/render/pages/specs-list/data-model";
import { specRunChoices, specLocked, specBusy } from "../../../../../src/render/pages/specs-list/row-state.ts";
import type { ExecutionGroup } from "../../../../../src/queue/execution-groups";

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

test("Jobs names what is happening while Specs shows only Active", () => {
  for (const [phase, word] of [["analyze", "Analyzing"], ["implement", "Implementing"], ["archive", "Archiving"]]) {
    const state = { key: "active" as const, phase };
    expect(specStateLabel(state, "en", false)).toBe(word!);
    expect(specStateLabel(state, "en", true)).toBe("Active");
  }
});

test("unfinished group members are Active, filtered as Active and offer no individual Run (AC-1, AC-2, AC-5)", () => {
  const targets = [{ project: "aide", specFolder: "820-next", done: ["create"] }];
  const execution = { project: "aide", members: ["821-first", "820-next"] } as ExecutionGroup;
  for (const state of ["prepared", "queued", "running", "stopped", "waiting-acceptance", "archiving"] as const) {
    const row = groupBySpec([], targets, undefined, undefined, Date.now(), undefined, [{ ...execution, state }])[0]!;
    expect(row.lead).toBeUndefined();
    expect(specState(row)).toEqual({ key: "active" });
    expect(applyFilter([row], { state: "active" })).toEqual([row]);
    expect(applyFilter([row], { state: "idle" })).toEqual([]);
    expect(specRunChoices(row, {})).toEqual([]);
    expect(specLocked(row)).toBe(true);
    expect(specBusy(row)).toBe(false);
  }
});

test("unfinished group membership takes priority over archived and closed state (AC-1, AC-2, AC-5)", () => {
  for (const ownState of ["archived", "closed"] as const) {
    const row = group({ state: ownState, executionGroupActive: true, project: "aide", specFolder: "820-next" });
    expect(specState(row)).toEqual({ key: "active" });
    expect(applyFilter([row], { state: "active" })).toEqual([row]);
    expect(applyFilter([row], { state: "idle" })).toEqual([]);
    expect(specRunChoices(row, {})).toEqual([]);
  }
});

test("completed, removed and other projects' groups restore the spec's own behavior (AC-3)", () => {
  const targets = [{ project: "aide", specFolder: "820-next", done: ["create"] }];
  const execution = { project: "aide", members: ["821-first", "820-next"] } as ExecutionGroup;
  for (const entry of [
    { ...execution, state: "completed" as const },
    { ...execution, state: "running" as const, removedAt: "2026-11-15T20:00:00Z" },
    { ...execution, state: "running" as const, project: "another" },
  ]) {
    const row = groupBySpec([], targets, undefined, undefined, Date.now(), undefined, [entry])[0]!;
    expect(specState(row).key).toBe("idle");
    expect(specRunChoices(row, {}).length).toBeGreaterThan(0);
  }
});
