import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionGroupStore } from "../../../src/queue/execution-groups/index.ts";
import { QueueStore } from "../../../src/queue/queue.ts";
import { clearAllStorageFaults } from "../../../src/queue/store/storage-faults.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-execution-groups-"));
  path = join(dir, "execution-groups.json");
});
afterEach(() => {
  clearAllStorageFaults();
  rmSync(dir, { recursive: true, force: true });
});

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

  test("persists the optional Archive choice and still reads old records (AC-4, AC-5)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "group/1-first" });
    store.update(made.id, { archiveModel: "fable", archiveProvider: "openai" });

    expect(new ExecutionGroupStore(path).get(made.id)).toMatchObject({ archiveModel: "fable", archiveProvider: "openai" });

    writeFileSync(path, JSON.stringify([{ id: "legacy", project: "aide", name: "Old", members: ["1-first"], branch: "group/1-first", state: "prepared", jobs: [], completedMembers: [] }]));
    expect(new ExecutionGroupStore(path).get("legacy")).toMatchObject({ name: "Old" });
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

  test("removing a completed group keeps every other field, across a reload (AC-3)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "group/1-first" });
    store.update(made.id, { jobs: [{ id: "job-1", specFolder: "1-first", logs: [{ step: "implement", sessionId: "s1", streamFile: "/logs/1" }] }] });
    store.start(made.id, "2026-11-11T18:01:00.000Z");
    const completed = store.complete(made.id, { prUrl: "https://example.test/pr/1", completedAt: "2026-11-11T18:10:00.000Z" });
    const removed = store.remove(made.id, "2026-11-11T18:20:00.000Z");
    expect(removed).toEqual({ ...completed, removedAt: "2026-11-11T18:20:00.000Z" });
    expect(new ExecutionGroupStore(path).get(made.id)).toEqual(removed);
  });

  test("drops a record whose removal date is not a string (AC-3)", () => {
    const entry = (id: string, name: string, rest: Record<string, unknown>) =>
      ({ id, project: "aide", name, members: ["1-first"], branch: "group/1-first", state: "completed", jobs: [], completedMembers: [], ...rest });
    writeFileSync(path, JSON.stringify([entry("bad", "Release", { removedAt: 17 }), entry("good", "Other", {})]));
    expect(new ExecutionGroupStore(path).list().map((group) => group.id)).toEqual(["good"]);
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
    store.update(made.id, { displayName: "Renamed" });
    expect(new ExecutionGroupStore(path).get(made.id)?.displayName).toBe("Renamed");
    expect(store.findUnfinished("aide", "Release")?.id).toBe(made.id);
    expect(store.findUnfinished("aide", "Renamed")?.id).toBe(made.id);
    expect(() => store.create({ project: "aide", name: "Renamed", members: ["3-third", "4-fourth"], branch: "group/3-third" })).toThrow("already exists");
    expect(store.get(made.id)?.members).toEqual(["1-first", "2-next"]);
  });
});

describe("loading a group's active job", () => {
  for (const state of ["queued", "running"] as const) {
    test(`corrects a saved Archiving group from its ${state} Implement job`, () => {
      const options = { mirrorPath: join(dir, "queue.json"), executionGroupsPath: path,
        defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
        resolve: () => ({ specFolders: ["1-first"] }) };
      const queue = new QueueStore(options);
      const group = queue.executionGroups.create({ project: "aide", name: "Release", members: ["1-first"], branch: "group/release" });
      const made = queue.enqueue({ project: "aide", specFolder: "1-first", steps: ["analyze", "implement", "archive"], executionGroupId: group.id });
      if (!made.ok) throw new Error(made.error);
      queue.writeUnchecked(made.job.id, { state, stepIndex: 1 });
      queue.executionGroups.update(group.id, { state: "archiving" });
      let changes = 0;
      const restored = new QueueStore({ ...options, onChange: () => { changes++; } });
      expect(restored.executionGroups.get(group.id)?.state).toBe(state);
      expect(new ExecutionGroupStore(path).get(group.id)?.state).toBe(state);
      expect(restored.get(made.job.id)?.stepIndex).toBe(1);
      expect(changes).toBe(0);

      for (const settled of ["stopped", "completed", "waiting-acceptance"] as const) {
        restored.executionGroups.update(group.id, { state: settled });
        expect(new QueueStore(options).executionGroups.get(group.id)?.state).toBe(settled);
      }
    });
  }
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

test("a user stop survives cancellation callbacks and reloads but clears when the group resumes", () => {
  const store = new ExecutionGroupStore(path);
  const group = store.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "group/release" });
  store.stop(group.id, true);
  store.stop(group.id);
  const restored = new ExecutionGroupStore(path);
  expect(restored.get(group.id)?.stoppedByUser).toBe(true);
  restored.queueMember(group.id, "2-next");
  restored.stop(group.id);
  expect(restored.get(group.id)?.stoppedByUser).toBeUndefined();
});

describe("ExecutionGroupStore on a file it cannot use", () => {
  const RELEASE = { project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first" };

  test("a file holding valid JSON that is not a list is reported, refuses changes and is left as it is (AC-2)", () => {
    writeFileSync(path, '{"x":1}');
    const store = new ExecutionGroupStore(path);
    expect(store.fault).toMatchObject({ file: path, store: "groups", action: "read" });
    expect(() => store.create(RELEASE)).toThrow(path);
    expect(readFileSync(path, "utf-8")).toBe('{"x":1}');
    expect(store.list()).toEqual([]);
  });

  test("an entry the store cannot read is kept beside the file before anything is written (AC-2)", () => {
    const valid = { id: "kept", project: "aide", name: "Old", members: ["1-first"], branch: "group/1-first", state: "prepared", jobs: [], completedMembers: [] };
    const broken = { id: "broken", project: "aide", state: "no-such-state" };
    writeFileSync(path, JSON.stringify([valid, broken]));
    const store = new ExecutionGroupStore(path, undefined, () => "group-2");
    store.create({ ...RELEASE, name: "New" });
    expect(store.list().map((group) => group.id).sort()).toEqual(["group-2", "kept"]);
    expect(JSON.parse(readFileSync(`${path}.rejected.json`, "utf-8"))).toEqual([broken]);
    expect(store.fault).toBeUndefined();
  });

  test("a failed write throws with the file and the reason and leaves the group as it was (AC-3)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.create(RELEASE);
    rmSync(path);
    mkdirSync(path);
    let message = "";
    try {
      store.update(made.id, { state: "running" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(path);
    expect(store.fault).toMatchObject({ file: path, store: "groups", action: "write" });
    expect(message).toContain(store.fault!.reason);
    expect(store.get(made.id)).toEqual(made);
  });

  test("a write blocked by a directory at the temporary file's path throws with the file and records the fault (AC-3)", () => {
    const store = new ExecutionGroupStore(path, () => "2026-11-11T18:00:00.000Z", () => "group-1");
    const made = store.create(RELEASE);
    mkdirSync(`${path}.tmp`);
    expect(() => store.update(made.id, { state: "running" })).toThrow(path);
    expect(store.fault).toMatchObject({ file: path, store: "groups", action: "write" });
    expect(store.get(made.id)).toEqual(made);
  });

});
