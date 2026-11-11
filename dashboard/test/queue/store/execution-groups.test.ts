import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionGroupStore } from "../../../src/queue/execution-groups/index.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-execution-groups-"));
  path = join(dir, "execution-groups.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ExecutionGroupStore", () => {
  test("prepares one durable identity with creation separate from members (AC-1, AC-2)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const group = store.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "group/1-first" });
    expect(group).toMatchObject({ id: "group-1", createdAt: "2026-11-11T18:00:00.000Z", state: "prepared" });
    expect(group.startedAt).toBeUndefined();
    expect(store.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "group/1-first" }).id).toBe("group-1");
  });

  test("persists lifecycle dates progress and history across reloads (AC-3, AC-4, AC-8)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.prepare({ project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first" });
    store.update(made.id, { state: "running", startedAt: "2026-11-11T18:01:00.000Z", currentMember: "1-first", completedMembers: [], jobs: [{ id: "job-1", specFolder: "1-first", logs: [{ step: "implement", sessionId: "s1", streamFile: "/logs/1" }] }] });
    expect(new ExecutionGroupStore(path).get(made.id)).toEqual(store.get(made.id));
  });

  test("resumes without replacing identity or first start (AC-5)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.prepare({ project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first" });
    store.start(made.id, "2026-11-11T18:01:00.000Z");
    store.update(made.id, { state: "stopped" });
    expect(store.start(made.id, "2026-11-11T19:00:00.000Z").startedAt).toBe("2026-11-11T18:01:00.000Z");
    expect(store.findUnfinished("aide", "Release")?.id).toBe("group-1");
  });

  test("keeps Archive failures unfinished and completes only after landing and PR (AC-6, AC-7)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.prepare({ project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first" });
    store.update(made.id, { state: "archiving", error: "merge failed" });
    expect(store.get(made.id)?.state).toBe("archiving");
    store.complete(made.id, { prUrl: "https://example.test/pr/1", completedAt: "2026-11-11T18:10:00.000Z" });
    expect(store.get(made.id)).toMatchObject({ state: "completed", prUrl: "https://example.test/pr/1" });
  });

  test("isolates malformed legacy entries and never invents missing dates (AC-9)", () => {
    writeFileSync(path, JSON.stringify([{ id: "legacy", project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first", state: "completed", jobs: [], completedMembers: ["1-first"] }, { nope: true }]));
    const first = new ExecutionGroupStore(path).list();
    const second = new ExecutionGroupStore(path).list();
    expect(first).toHaveLength(1);
    expect(first[0]?.createdAt).toBeUndefined();
    expect(second).toEqual(first);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toHaveLength(2);
  });

  test("reconciles legacy membership and job logs without inventing creation dates (AC-8, AC-9)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "legacy-1");
    const group = store.reconcile({
      project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first",
      completedMembers: ["1-first"],
    }, [{ id: "job-1", specFolder: "1-first", results: [{ step: "implement", sessionId: "s1", streamFile: "/logs/1" }] }]);
    expect(group).toMatchObject({ id: "legacy-1", completedMembers: ["1-first"], state: "stopped" });
    expect(group.createdAt).toBeUndefined();
    expect(group.jobs[0]?.logs[0]).toEqual({ step: "implement", sessionId: "s1", streamFile: "/logs/1" });
  });
});
