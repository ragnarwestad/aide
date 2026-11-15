import { expect, test } from "bun:test";
import { groupBySpec } from "../../../../src/render/pages/specs-list/data-model";
import { withGroupArchive } from "../../../../src/render/pages/specs-list/group-archive-projection.ts";
import { phasePipKind } from "../../../../src/render/pages/specs-list/cell-helpers.ts";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { row } from "../fixtures.ts";

const execution: ExecutionGroup = {
  id: "group-1", project: "aide", name: "Release", members: ["1-first", "2-next"],
  branch: "group/release", state: "running", completedMembers: [], jobs: [],
};
const members = groupBySpec([], execution.members.map((specFolder, index) => ({
  project: "aide", specFolder, done: ["create"], group: { name: "Release", position: index + 1 },
})));
const planned = row({ project: "aide", specFolder: "1-first", executionGroupId: execution.id,
  steps: ["analyze", "implement", "archive"], stepIndex: 0, state: "running" });
const project = (...jobs: (typeof planned)[]) => members.map((member) => withGroupArchive(member, {
  executionGroups: [execution], groupJobs: jobs,
}));

test("Archive has no attempt or coloured pip while an earlier member phase runs or is interrupted", () => {
  for (const job of [planned, { ...planned, stepIndex: 1, state: "interrupted" as const }]) {
    for (const member of project(job)) {
      const archive = member.phases.find((phase) => phase.step === "archive")!;
      expect(archive.attempts).toEqual([]);
      expect(phasePipKind(archive, member.done)).toBe("todo");
    }
  }
});

test("an actual Archive attempt shares only Archive's state and cost with the members", () => {
  const job = { ...planned, groupMembers: execution.members, stepIndex: 2, spentUsd: 6, spentTokens: 600, results: [
    { step: "analyze", ok: true, costUsd: 1, tokens: 100 },
    { step: "implement", ok: true, costUsd: 3, tokens: 300 },
  ] };
  for (const member of project(job)) {
    const archive = member.phases.find((phase) => phase.step === "archive")!;
    expect(archive.attempts[0]).toMatchObject({ state: "running", spentUsd: 2, spentTokens: 200 });
    expect(phasePipKind(archive, member.done)).toBe("now");
  }
  for (const member of project({ ...job, state: "interrupted" })) {
    const archive = member.phases.find((phase) => phase.step === "archive")!;
    expect(phasePipKind(archive, member.done)).toBe("refused");
  }
});

test("a newer planned Archive cannot replace an earlier actual Archive attempt", () => {
  const actual = { ...planned, id: "actual", steps: ["archive"], state: "interrupted" as const, createdAt: "2026-11-15T10:00:00Z" };
  const newer = { ...planned, id: "planned", createdAt: "2026-11-15T11:00:00Z" };
  const unrelated = { ...actual, id: "other-group", executionGroupId: "other", createdAt: "2026-11-15T12:00:00Z" };
  for (const member of project(actual, newer, unrelated)) {
    const archive = member.phases.find((phase) => phase.step === "archive")!;
    expect(archive.attempts.map((attempt) => attempt.id)).toEqual(["actual"]);
    expect(phasePipKind(archive, member.done)).toBe("refused");
  }
});

test("an old individual Archive on a member is not the group's shared Archive", () => {
  for (const member of project({ ...planned, stepIndex: 2, state: "cancelled" })) {
    const archive = member.phases.find((phase) => phase.step === "archive")!;
    expect(archive.attempts).toEqual([]);
    expect(phasePipKind(archive, member.done)).toBe("todo");
  }
});
