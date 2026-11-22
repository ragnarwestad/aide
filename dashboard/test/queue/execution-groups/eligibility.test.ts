import { expect, test } from "bun:test";
import { eligibleGroupMembers, groupableProjects, lockedGroupMembers, orderGroupMembers, validateExecutionGroupEdit, validateExecutionGroupRequest } from "../../../src/queue/execution-groups/eligibility.ts";
import type { GroupFacts } from "../../../src/project/spec-facts.ts";

const target = (specFolder: string, extra: Record<string, unknown> = {}) => ({
  project: "aide", specFolder, title: `Title ${specFolder}`, done: ["create"], dependsOn: [], ...extra,
});

test("offers only current same-project members without conflicting work (AC-4)", () => {
  const offered = eligibleGroupMembers({
    project: "aide",
    targets: [target("1-ready"), target("2-busy"), target("3-owned", { group: { name: "Other", position: 1 } }), { ...target("4-other"), project: "atlas" }],
    groups: [{ id: "other", project: "aide", name: "Other", members: ["3-owned"], branch: "group/3-owned", state: "prepared", completedMembers: [], jobs: [] }],
    jobs: [{ project: "aide", specFolder: "2-busy", state: "queued" }],
  });
  expect(offered.map((item) => item.specFolder)).toEqual(["1-ready"]);
});

test("a removed group no longer owns a spec with only a cancelled attempt", () => {
  const offered = eligibleGroupMembers({
    project: "aide",
    targets: [target("1-peer"), target("2-still-owned")],
    groups: [
      { id: "removed", project: "aide", name: "Old", members: ["1-peer"], branch: "group/1", state: "stopped", completedMembers: [], jobs: [], removedAt: "2026-11-18T07:28:49Z" },
      { id: "active", project: "aide", name: "Active", members: ["2-still-owned"], branch: "group/2", state: "stopped", completedMembers: [], jobs: [] },
    ],
    jobs: [{ project: "aide", specFolder: "1-peer", state: "cancelled" }],
  });
  expect(offered.map((item) => item.specFolder)).toEqual(["1-peer"]);
});

test("excludes specs whose work already started outside a group (AC-4, AC-7)", () => {
  const offered = eligibleGroupMembers({
    project: "aide",
    targets: [target("1-ready"), target("2-analyzed", { done: ["create", "analyze"] }), target("3-implemented", { done: ["create", "analyze", "implement"] })],
    groups: [], jobs: [],
  });
  expect(offered.map((item) => item.specFolder)).toEqual(["1-ready"]);
});

test("offers specs that depend on each other (AC-6)", () => {
  const offered = eligibleGroupMembers({
    project: "aide",
    targets: [target("1-first", { dependsOn: ["2-required"] }), target("2-required")],
    groups: [], jobs: [],
  });
  expect(offered.map((item) => item.specFolder)).toEqual(["1-first", "2-required"]);
});

test("accepts a dependency before its dependent (AC-1)", () => {
  const targets = [target("1-first", { dependsOn: ["2-required"] }), target("2-required")];
  expect(validateExecutionGroupRequest({
    project: "aide", members: ["2-required", "1-first"], positions: [1, 2], targets, groups: [], jobs: [],
  })).toEqual({ ok: true, members: ["2-required", "1-first"] });
});

test("normalizes positions and moves dependencies before dependents (A810 AC-5, A810 AC-6)", () => {
  const targets = [target("1-first", { dependsOn: ["2-required"] }), target("2-required")];
  expect(validateExecutionGroupRequest({
    project: "aide", members: ["1-first", "2-required"], positions: [4, 4], targets, groups: [], jobs: [],
  })).toEqual({ ok: true, members: ["2-required", "1-first"] });
});

test("keeps unrelated selection order while normalizing transitive dependencies (A810 AC-5, A810 AC-6)", () => {
  const targets = [target("1-dependent", { dependsOn: ["2-middle"] }), target("2-middle", { dependsOn: ["3-required"] }), target("3-required"), target("4-unrelated")];
  expect(validateExecutionGroupRequest({
    project: "aide", members: ["4-unrelated", "1-dependent", "2-middle", "3-required"], targets, groups: [], jobs: [],
  })).toEqual({ ok: true, members: ["4-unrelated", "3-required", "2-middle", "1-dependent"] });
});

test("refuses duplicate members but accepts missing positions (A810 AC-6)", () => {
  const targets = [target("1-first"), target("2-required")];
  expect(validateExecutionGroupRequest({ project: "aide", members: ["1-first", "1-first"], targets, groups: [], jobs: [] })).toMatchObject({ ok: false });
  expect(validateExecutionGroupRequest({ project: "aide", members: ["1-first", "2-required"], targets, groups: [], jobs: [] })).toEqual({ ok: true, members: ["1-first", "2-required"] });
});

test("a Run group may use its already-analyzed lead while peers stay eligible (A810 AC-2, A810 AC-3)", () => {
  const targets = [target("1-lead", { done: ["create", "analyze"] }), target("2-peer")];
  expect(validateExecutionGroupRequest({
    project: "aide", members: ["1-lead", "2-peer"], lead: "1-lead", targets, groups: [], jobs: [],
  })).toEqual({ ok: true, members: ["1-lead", "2-peer"] });
});

test("only members through Implement, in flight, or no longer active are locked (AC-4, AC-5)", () => {
  const group = { id: "release", project: "aide", name: "Release", members: ["1-done", "2-ran", "3-busy", "4-new", "5-archived"], branch: "group/1", state: "running", completedMembers: ["1-done"], jobs: [{ id: "old", specFolder: "2-ran", logs: [] }] } as never;
  const targets = [target("1-done", { done: ["implement"] }), target("2-ran"), target("3-busy"), target("4-new")];
  expect([...lockedGroupMembers({ group, targets, jobs: [{ project: "aide", specFolder: "3-busy", state: "queued" }] })]).toEqual(["1-done", "3-busy", "5-archived"]);
});

test("an edit keeps locked positions, allows new candidates, and checks dependency order (AC-4, AC-5, AC-6, AC-7)", () => {
  const group = { id: "release", project: "aide", name: "Release", members: ["1-first", "2-second"], branch: "group/1", state: "prepared", completedMembers: ["1-first"], jobs: [] } as never;
  const targets = [target("1-first", { group: { name: "Release", position: 1 } }), target("2-second", { group: { name: "Release", position: 2 }, dependsOn: ["3-new"] }), target("3-new")];
  const base = { project: "aide", group, targets, groups: [group], jobs: [], locked: new Set(["1-first"]) };
  expect(validateExecutionGroupEdit({ ...base, members: ["1-first", "3-new", "2-second"], positions: [1, 2, 3] })).toEqual({ ok: true, members: ["1-first", "3-new", "2-second"] });
  expect(validateExecutionGroupEdit({ ...base, members: ["2-second", "1-first"], positions: [1, 2] })).toMatchObject({ ok: false });
  expect(validateExecutionGroupEdit({ ...base, members: ["1-first", "2-second", "3-new"], positions: [1, 2, 3] })).toEqual({ ok: true, members: ["1-first", "3-new", "2-second"] });
});

test("removing an unlocked member before a locked member closes the position gap (AC-4, AC-5)", () => {
  const group = { id: "release", project: "aide", name: "Release", members: ["1-first", "2-locked", "3-third"], branch: "group/1", state: "prepared", completedMembers: ["2-locked"], jobs: [] } as never;
  const targets = [target("1-first"), target("2-locked", { done: ["implement"] }), target("3-third")];
  expect(validateExecutionGroupEdit({
    project: "aide", group, members: ["2-locked", "3-third"], positions: [1, 2], locked: new Set(["2-locked"]),
    targets, groups: [group], jobs: [],
  })).toEqual({ ok: true, members: ["2-locked", "3-third"] });
});


test("keeps insertion order among ready members and names a dependency cycle", () => {
  const base = { project: "aide", groups: [], jobs: [], members: ["1-first", "2-second", "3-third"] };
  expect(validateExecutionGroupRequest({ ...base, targets: [target("1-first"), target("2-second"), target("3-third")] })).toEqual({ ok: true, members: base.members });
  const cycle = validateExecutionGroupRequest({ ...base, targets: [target("1-first", { dependsOn: ["2-second"] }), target("2-second", { dependsOn: ["1-first"] }), target("3-third")] });
  expect(cycle).toMatchObject({ ok: false });
  if (!cycle.ok) {
    expect(cycle.error).toContain("circular dependencies");
    expect(cycle.error).toContain("1-first");
    expect(cycle.error).toContain("2-second");
  }
});

test("decides from the group facts alone and offers the caller's own objects (AC-1, AC-4)", () => {
  const facts: GroupFacts[] = [
    { project: "aide", specFolder: "1-first", dependsOn: ["2-required"], done: ["create"] },
    { project: "aide", specFolder: "2-required", done: ["create"] },
    { project: "aide", specFolder: "3-implemented", done: ["create", "analyze", "implement"] },
  ];
  const offered = eligibleGroupMembers({ project: "aide", targets: facts, groups: [], jobs: [] });
  expect(offered).toHaveLength(2);
  expect(offered[0]).toBe(facts[0]!);
  expect(offered[1]).toBe(facts[1]!);
  const group = { id: "g", project: "aide", name: "G", members: ["1-first", "3-implemented"], branch: "group/g", state: "prepared" as const, completedMembers: [], jobs: [] };
  expect([...lockedGroupMembers({ group, targets: facts, jobs: [] })]).toEqual(["3-implemented"]);
  expect(orderGroupMembers(["1-first", "2-required"], facts)).toEqual({ ok: true, members: ["2-required", "1-first"] });
});

test("a project can make a group only with two specs to offer", () => {
  const offered = [
    { project: "atlas", specFolder: "1" }, { project: "atlas", specFolder: "2" },
    { project: "aide", specFolder: "3" }, { project: "aide", specFolder: "4" },
    { project: "paceup", specFolder: "5" },
  ];
  expect(groupableProjects(offered)).toEqual(["aide", "atlas"]);
  expect(groupableProjects(offered.slice(4))).toEqual([]);
  expect(groupableProjects([])).toEqual([]);
});
