import { expect, test } from "bun:test";
import { eligibleGroupMembers, lockedGroupMembers, validateExecutionGroupEdit, validateExecutionGroupRequest } from "../../../src/queue/execution-groups/eligibility.ts";

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

test("refuses a dependent before its dependency and names the order (AC-2)", () => {
  const targets = [target("1-first", { dependsOn: ["2-required"] }), target("2-required")];
  expect(validateExecutionGroupRequest({
    project: "aide", members: ["1-first", "2-required"], positions: [1, 2], targets, groups: [], jobs: [],
  })).toEqual({
    ok: false,
    error: "1-first depends on 2-required, so 2-required must come before 1-first in the group's order",
  });
});

test("refuses duplicates and missing positions before save", () => {
  const targets = [target("1-first", { dependsOn: ["2-required"] }), target("2-required")];
  expect(validateExecutionGroupRequest({ project: "aide", members: ["1-first", "1-first"], targets, groups: [], jobs: [] })).toMatchObject({ ok: false });
  expect(validateExecutionGroupRequest({ project: "aide", members: ["1-first"], positions: [2], targets, groups: [], jobs: [] })).toMatchObject({ ok: false });
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
  expect(validateExecutionGroupEdit({ ...base, members: ["1-first", "2-second", "3-new"], positions: [1, 2, 3] })).toEqual({ ok: false, error: "2-second depends on 3-new, so 3-new must come before 2-second in the group's order" });
});

test("removing an unlocked member before a locked member closes the position gap (AC-4, AC-5)", () => {
  const group = { id: "release", project: "aide", name: "Release", members: ["1-first", "2-locked", "3-third"], branch: "group/1", state: "prepared", completedMembers: ["2-locked"], jobs: [] } as never;
  const targets = [target("1-first"), target("2-locked", { done: ["implement"] }), target("3-third")];
  expect(validateExecutionGroupEdit({
    project: "aide", group, members: ["2-locked", "3-third"], positions: [1, 2], locked: new Set(["2-locked"]),
    targets, groups: [group], jobs: [],
  })).toEqual({ ok: true, members: ["2-locked", "3-third"] });
});
