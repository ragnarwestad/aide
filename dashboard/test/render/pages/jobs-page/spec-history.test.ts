import { selectWindow, windowQuery } from "../../../../src/render/pages/list-window";
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


test("the Jobs window limits rendering while keeping explicitly opened cards (AC-1, AC-9)", () => {
  const all = Array.from({ length: 225 }, (_, i) => ({ key: String(i) }));
  expect(jobWindow(all)).toEqual(all.slice(0, 100));
  expect(jobWindow(all, "200")).toHaveLength(200);
  for (const invalid of ["invalid", "-1", "100.5", "1e3", "101", "9007199254741000"]) {
    expect(jobWindow(all, invalid)).toHaveLength(100);
  }
  expect(jobWindow(all, undefined, new Set(["224"]))).toEqual([...all.slice(0, 100), all[224]!]);
});

test("a loaded boundary survives insertions and loads another complete batch (AC-7)", () => {
  const all = Array.from({ length: 350 }, (_, i) => ({ key: String(i) }));
  const first = selectWindow(all);
  expect(first.boundary).toBe("99");
  const changed = [{ key: "new" }, ...all];
  const live = selectWindow(changed, { limit: "100", boundary: first.boundary });
  expect(live.rows).toEqual(changed.slice(0, 101));
  const more = selectWindow(changed, { limit: "200", boundary: first.boundary, grow: true });
  expect(more.rows).toEqual(changed.slice(0, 201));
  expect(new Set(more.rows.map((r) => r.key)).size).toBe(201);
  expect(selectWindow(all.filter((r) => r.key !== "99"), { boundary: "99" }).loaded).toBe(100);
});

test("query identity ignores folds and resets ranges for a different query (AC-6)", () => {
  const first = windowQuery("/specs", { state: "all", q: " hello ", sort: "created" });
  expect(windowQuery("/specs", { state: "all", q: "hello", sort: "created", open: "p/old", limit: "200" })).toBe(first);
  const all = Array.from({ length: 250 }, (_, i) => ({ key: String(i) }));
  expect(selectWindow(all, { limit: "200", query: "new", previousQuery: first, boundary: "199" }).loaded).toBe(100);
});

test("a group is selected atomically and opened exceptions do not move the boundary (AC-8)", () => {
  const all = Array.from({ length: 201 }, (_, i) => ({ key: String(i), members: i === 99 ? Array.from({ length: 150 }, (_, n) => n) : [] }));
  const selected = selectWindow(all, { opened: new Set(["200"]) });
  expect(selected.rows).toHaveLength(101);
  expect(selected.rows[99]!.members).toHaveLength(150);
  expect(selected.boundary).toBe("99");
  expect(selected.total).toBe(201);
  expect(selected.hasMore).toBe(true);
});


test("loaded running jobs remain visible after insertions and a completed boundary job (AC-7)", () => {
  const running = Array.from({ length: 250 }, (_, i) => ({ key: String(i) }));
  const initial = selectWindow(running);
  const inserted = [{ key: "new-1" }, { key: "new-2" }, ...running];
  const live = selectWindow(inserted, { boundary: initial.boundary, loaded: String(initial.loaded) });
  expect(live.loaded).toBe(102);
  const remaining = inserted.filter((row) => row.key !== live.boundary);
  const refreshed = selectWindow(remaining, { boundary: live.boundary, loaded: String(live.loaded) });
  for (const row of live.rows.filter((row) => row.key !== live.boundary)) expect(refreshed.rows).toContainEqual(row);
  expect(refreshed.loaded).toBe(102);
  const more = selectWindow(remaining, { limit: "200", grow: true, boundary: live.boundary, loaded: String(live.loaded) });
  expect(more.loaded).toBe(202);
  expect(selectWindow(remaining, { loaded: "202", query: "new", previousQuery: "old" }).loaded).toBe(100);
});
