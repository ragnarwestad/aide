import { expect, test } from "bun:test";
import { eligibleGroupMembers, validateExecutionGroupRequest } from "../../../src/queue/execution-groups/eligibility.ts";

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
