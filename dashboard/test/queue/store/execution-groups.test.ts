import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionGroupStore } from "../../../src/queue/execution-groups/index.ts";
import { QueueStore } from "../../../src/queue/queue.ts";

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

  test("stops a running execution without losing its first start (AC-7)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.prepare({ project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first" });
    store.start(made.id, "2026-11-11T18:01:00.000Z");
    const stopped = store.stop(made.id);
    expect(stopped).toMatchObject({ state: "stopped", startedAt: "2026-11-11T18:01:00.000Z" });
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

  test("refuses a second new group with the same unfinished name without changing the first (AC-5)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "group/1-first" });
    expect(() => store.create({ project: "aide", name: "Release", members: ["3-third", "4-fourth"], branch: "group/3-third" })).toThrow("already exists");
    expect(store.get(made.id)?.members).toEqual(["1-first", "2-next"]);
  });
});

describe("a group's job ending", () => {
  const queueWithGroup = () => {
    const queue = new QueueStore({
      defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
      resolve: () => ({ specFolders: ["1-first", "2-next"] }),
    });
    const group = queue.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
    const run = (specFolder: string, steps: string[]) => {
      const made = queue.enqueue({ project: "aide", specFolder, steps, executionGroupId: group.id });
      if (!made.ok) throw new Error(made.error);
      queue.transition(made.job.id, "start");
      return made.job.id;
    };
    return { queue, group, run };
  };

  for (const [event, label] of [["step-succeeded-last", "done"], ["cancel", "cancelled"]] as const) {
    test(`leaves the group idle when it ends ${label} with nothing else of the group queued`, () => {
      const { queue, group, run } = queueWithGroup();
      const id = run("2-next", ["analyze"]);
      expect(queue.executionGroups.get(group.id)?.state).toBe("running");
      queue.transition(id, event);
      expect(queue.executionGroups.get(group.id)?.state).toBe("stopped");
    });
  }

  test("keeps the group going while its next job is already queued", () => {
    const { queue, group, run } = queueWithGroup();
    const id = run("1-first", ["implement"]);
    const next = queue.enqueue({ project: "aide", specFolder: "2-next", steps: ["analyze"], executionGroupId: group.id });
    expect(next.ok).toBe(true);
    queue.transition(id, "step-succeeded-last");
    expect(queue.executionGroups.get(group.id)?.state).toBe("queued");
  });

  test("keeps a group that waits for Archive waiting", () => {
    const { queue, group, run } = queueWithGroup();
    const id = run("2-next", ["implement"]);
    queue.executionGroups.waitForAcceptance(group.id);
    queue.transition(id, "step-succeeded-last");
    expect(queue.executionGroups.get(group.id)?.state).toBe("waiting-acceptance");
  });

  test("keeps the group archiving from its archive job's start until the landing settles", () => {
    const { queue, group, run } = queueWithGroup();
    const id = run("1-first", ["archive"]);
    expect(queue.executionGroups.get(group.id)?.state).toBe("archiving");
    queue.transition(id, "step-succeeded-last");
    expect(queue.executionGroups.get(group.id)?.state).toBe("archiving");
    queue.executionGroups.archiveSettled(group.id, { prUrl: "https://example.test/pr/1" });
    queue.update(id, { prUrl: "https://example.test/pr/1" });
    expect(queue.executionGroups.get(group.id)?.state).toBe("completed");
  });

  test("leaves the group waiting for Archive again when its archive is held back", () => {
    const { queue, group, run } = queueWithGroup();
    const id = run("1-first", ["archive"]);
    queue.transition(id, "step-succeeded-last");
    expect(queue.executionGroups.archiveSettled(group.id, "held-back").state).toBe("waiting-acceptance");
  });

  test("stops the group when its archive job is cancelled", () => {
    const { queue, group, run } = queueWithGroup();
    const id = run("1-first", ["archive"]);
    queue.transition(id, "cancel");
    expect(queue.executionGroups.get(group.id)?.state).toBe("stopped");
  });
});
