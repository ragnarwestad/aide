// A spec drawn inside a group's card is not a row of the list of its own,
// yet its › asks for that spec's rows alone.

import { expect, test } from "bun:test";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { renderJobsSpecRows, type JobsView } from "../../../../src/render/pages/jobs-page";

const release: ExecutionGroup = {
  id: "g1", project: "aide", name: "Release", members: ["82-first", "83-second"], branch: "group/82-first",
  state: "prepared", createdAt: "2026-11-10T12:00:00.000Z", completedMembers: [], jobs: [],
};
const view = (groups: ExecutionGroup[]): JobsView => ({
  shown: [],
  specJobs: [],
  executionGroups: groups,
  list: {
    runnerAvailable: true, createProjects: ["aide"],
    targets: ["81-alone", "82-first", "83-second"].map((specFolder) => ({ project: "aide", specFolder })),
  },
  now: Date.parse("2026-11-12T12:00:00Z"),
});
const rowsOf = (v: JobsView, key: string): string => renderJobsSpecRows(v, key).replace(/<\/?t(able|body)>/g, "");

test("a member's rows are answered while its group's card is on the list", () => {
  expect(rowsOf(view([release]), "aide/82-first")).toContain('id="spec-aide/82-first"');
  expect(rowsOf(view([release]), "aide/81-alone")).toContain('id="spec-aide/81-alone"');
  expect(rowsOf(view([release]), "aide/99-missing")).toBe("");
});
