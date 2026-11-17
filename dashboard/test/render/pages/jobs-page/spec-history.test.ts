import { expect, test } from "bun:test";
import { jobsTabHasRows, type JobsView } from "../../../../src/render/pages/jobs-page";
import { jobWindow, specHasWork } from "../../../../src/render/pages/jobs-page/rows.ts";
import type { SpecGroup } from "../../../../src/render/pages/specs-list/data-model";
import type { QueueRowView } from "../../../../src/render";

const fresh = (): JobsView => ({
  shown: [], specJobs: [],
  list: { runnerAvailable: true, targets: [{ project: "aide", specFolder: "814-new", done: ["create"] }] },
});

test("an archived record or stopped phase still proves work without a queued job", () => {
  const base = { done: ["create"], phases: [] } as unknown as SpecGroup;
  expect(specHasWork({ ...base, archive: {} as SpecGroup["archive"] })).toBe(true);
  expect(specHasWork({ ...base, phases: [{ step: "analyze", history: { stopped: "timeout" } }] as SpecGroup["phases"] })).toBe(true);
  expect(specHasWork({ ...base, phases: [{ step: "implement", history: { historyDone: true } }] as SpecGroup["phases"] })).toBe(true);
});

test("before the first specs sweep, a spec with no recorded work keeps its row on Jobs (AC-4)", () => {
  const view = fresh();
  view.specsScanned = false;
  expect(jobsTabHasRows(view)).toBe(true);
  expect(specHasWork({ done: ["create"], phases: [] } as unknown as SpecGroup, false)).toBe(true);
});

test("once the first specs sweep has finished, only a spec with recorded work keeps its row (AC-5)", () => {
  const view = fresh();
  view.specsScanned = true;
  expect(jobsTabHasRows(view)).toBe(false);
  view.list.targets[0]!.done = ["create", "analyze"];
  expect(jobsTabHasRows(view)).toBe(true);
});

test("a standalone spec with only its creation record has no row on Jobs", () => {
  expect(jobsTabHasRows(fresh())).toBe(false);
});

test("past work stays on Jobs after the queue forgets the job", () => {
  for (const step of ["analyze", "implement", "archive", "reopen"]) {
    const view = fresh();
    view.list.targets[0]!.done = ["create", step];
    expect(jobsTabHasRows(view)).toBe(true);
  }
});

test("a spec appears as soon as its first job is queued, including a failed first run", () => {
  for (const state of ["queued", "running", "failed", "stopped", "cancelled", "done"] as const) {
    const view = fresh();
    view.specJobs = [{
      id: "j1", project: "aide", specFolder: "814-new", steps: ["analyze"], stepIndex: 0, state,
      spentUsd: 0, timeoutSec: 600, createdAt: "2026-11-15T18:00:00Z",
    } as QueueRowView];
    expect(jobsTabHasRows(view)).toBe(true);
  }
});

test("prepared groups remain on Jobs before any member has run", () => {
  const view = fresh();
  view.list.targets.push({ project: "aide", specFolder: "815-new", done: ["create"] });
  view.executionGroups = [{
    id: "g1", project: "aide", name: "Release", members: ["814-new", "815-new"],
    branch: "group/814", state: "prepared", completedMembers: [], jobs: [],
  }];
  expect(jobsTabHasRows(view)).toBe(true);
  view.executionGroups = [];
  view.list.targets.forEach((target, position) => { target.group = { name: "Release", position }; });
  expect(jobsTabHasRows(view)).toBe(true);
});


test("the Jobs window limits rendering while keeping explicitly opened cards", () => {
  const all = Array.from({ length: 125 }, (_, i) => ({ key: String(i) }));
  expect(jobWindow(all).map((row) => row.key)).toEqual(all.slice(0, 50).map((row) => row.key));
  expect(jobWindow(all, "100")).toHaveLength(100);
  expect(jobWindow(all, "invalid")).toHaveLength(50);
  expect(jobWindow(all, "-1")).toHaveLength(50);
  expect(jobWindow(all, undefined, new Set(["124"])).map((row) => row.key)).toEqual([...all.slice(0, 50).map((row) => row.key), "124"]);
});
