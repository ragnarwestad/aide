// A spec drawn inside a group's card is not a row of the list of its own,
// yet its › asks for that spec's rows alone. What a chosen state shows of a
// group is read off its members' current rows.

import { expect, test } from "bun:test";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import type { QueueRowView } from "../../../../src/render";
import { jobsTabHasRows, renderJobsRows, renderJobsSpecRows, type JobsView } from "../../../../src/render/pages/jobs-page";

const release: ExecutionGroup = {
  id: "g1", project: "aide", name: "Release", members: ["82-first", "83-second"], branch: "group/82-first",
  state: "prepared", createdAt: "2026-11-10T12:00:00.000Z", completedMembers: [], jobs: [],
};
const view = (groups: ExecutionGroup[], o: { state?: string; folders?: string[]; specJobs?: QueueRowView[] } = {}): JobsView => ({
  shown: [],
  specJobs: o.specJobs ?? [],
  executionGroups: groups,
  list: {
    runnerAvailable: true, createProjects: ["aide"],
    targets: (o.folders ?? ["81-alone", "82-first", "83-second"]).map((specFolder) => ({ project: "aide", specFolder })),
    filter: o.state ? { state: o.state } : undefined,
  },
  now: Date.parse("2026-11-12T12:00:00Z"),
});
const rowsOf = (v: JobsView, key: string): string => renderJobsSpecRows(v, key).replace(/<\/?t(able|body)>/g, "");
const CARD = "execution-group:g1";

test("a member's rows are answered while its group's card is on the list", () => {
  expect(rowsOf(view([release]), "aide/82-first")).toContain('id="spec-aide/82-first"');
  expect(rowsOf(view([release]), "aide/81-alone")).toContain('id="spec-aide/81-alone"');
  expect(rowsOf(view([release]), "aide/99-missing")).toBe("");
});

test("a prepared group whose members have not started has no row under Stopped (AC-3)", () => {
  expect(jobsTabHasRows(view([release], { folders: ["82-first", "83-second"], state: "stopped" }))).toBe(false);
  expect(jobsTabHasRows(view([release], { folders: ["82-first", "83-second"], state: "not-archived" }))).toBe(true);
});

test("a chosen state reaches the card, drawn open with its members (AC-4)", () => {
  const card = rowsOf(view([release], { state: "not-archived" }), CARD);
  expect(card).toContain('data-group-open="not-archived"');
  expect(card).not.toContain("data-group-body hidden");
  expect(card).toContain('id="spec-aide/83-second"');
  expect(rowsOf(view([release]), CARD)).not.toContain("data-group-open");
});

test("a reopened member is read by its current round; its earlier round is a row of its own (AC-1, AC-3)", () => {
  const job = (o: Partial<QueueRowView>): QueueRowView => ({
    id: "j", project: "aide", specFolder: "82-first", steps: ["analyze"], stepIndex: 0, state: "done",
    spentUsd: 0, timeoutSec: 600, results: [], createdAt: "2026-11-01T10:00:00Z",
    startedAt: "2026-11-01T10:00:00Z", finishedAt: "2026-11-01T10:05:00Z", ...o,
  }) as QueueRowView;
  const reopenedAt = "2026-11-05T10:05:00Z";
  const specJobs = [
    job({ id: "first" }),
    job({ id: "reopen", steps: ["reopen"], createdAt: "2026-11-05T10:00:00Z", startedAt: "2026-11-05T10:00:00Z", finishedAt: reopenedAt }),
    job({ id: "now", steps: ["implement"], state: "running", createdAt: "2026-11-12T11:00:00Z", startedAt: "2026-11-12T11:00:00Z", finishedAt: undefined }),
  ];
  const earlier = `aide/82-first@${encodeURIComponent("2026-11-01T10:00:00Z")}`;
  expect(rowsOf(view([release], { state: "active:all", specJobs }), CARD)).toContain('data-group-open="active:all"');
  expect(rowsOf(view([release], { state: "done", specJobs }), CARD)).toBe("");
  expect(rowsOf(view([release], { state: "done", specJobs }), earlier)).toContain(`id="spec-${earlier}"`);
});

const removed: ExecutionGroup = {
  ...release, state: "completed", completedAt: "2026-11-11T12:00:00.000Z", removedAt: "2026-11-12T09:00:00.000Z",
};

test("a removed group draws no card, and its members are drawn as their own rows (AC-4)", () => {
  const withCard = renderJobsRows(view([{ ...removed, removedAt: undefined }]));
  expect(withCard).toContain('data-spec-group="aide\nRelease"');

  const html = renderJobsRows(view([removed]));
  expect(html).not.toContain('data-spec-group="aide\nRelease"');
  expect(html).toContain('id="spec-aide/82-first"');
  expect(html).toContain('id="spec-aide/83-second"');
});

test("a removed group's members draw no card from their Group: lines (AC-5)", () => {
  const grouped = view([removed]);
  grouped.list.targets = ["82-first", "83-second"].map((specFolder, index) => ({
    project: "aide", specFolder, group: { name: "Release", position: index + 1 },
  }));
  expect(renderJobsRows(grouped)).not.toContain('data-spec-group="aide\nRelease"');
});
