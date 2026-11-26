// One queue: a job that reaches its merge goes to the back of it, and in a
// project the merges run one at a time in the queue's order. A Merge job
// moved ahead of an archive's waiting merge merges first.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { dispatchFor } from "../../../src/queue/waiting/dispatch.ts";
import { createRootLock } from "../../../src/serve/serve-helpers/config.ts";
import { cleanupHarness, enqueue, makeRunner, resetHarness, store } from "../runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function held(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  return { promise: new Promise<void>((resolve) => { release = resolve; }), release };
}

test("a Merge job moved ahead of an archive's waiting merge merges before it", async () => {
  const roots = createRootLock();
  const dispatch = dispatchFor(store.waiting);
  const calls: string[] = [];
  const mergeOf = (jobId: string, operation: string) =>
    ({ id: `merge:${jobId}:${operation}:code`, jobId, project: "aide", label: jobId, operation, reason: "" });

  // A Merge job is merging into main.
  const running = enqueue({ specFolder: "land", steps: ["land"], branch: "running" });
  store.writeUnchecked(running.id, { state: "running", landing: true });
  const first = held();
  const firstMerge = dispatch.run(mergeOf(running.id, "land"), roots, "code", () => { calls.push("running"); return first.promise; });
  await flush();

  // An archive reaches its merge and goes to the back of the queue.
  const archive = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
  store.writeUnchecked(archive.id, { state: "done", landing: true });
  const archiveDone = held();
  const archiveMerge = dispatch.run(mergeOf(archive.id, "archive"), roots, "code", () => { calls.push("archive"); return archiveDone.promise; });

  // A Merge job queued after it is moved to the front.
  const moved = enqueue({ specFolder: "land", steps: ["land"], branch: "moved" });
  const owner = store.waiting.open("edit", `job:${moved.id}:0`);
  const ids = owner.entries.map((entry) => entry.id);
  store.waiting.save(owner, [`job:${moved.id}:0`, ...ids.filter((id) => id !== `job:${moved.id}:0`)]);

  // The running merge ends.
  first.release();
  await firstMerge;
  store.writeUnchecked(running.id, { state: "done", landing: undefined });
  await flush();
  expect(calls).toEqual(["running"]);

  // The moved Merge job starts, and the archive waits while it reaches its merge.
  const runner = makeRunner({ maxConcurrent: 4 });
  runner.tick();
  expect(store.get(moved.id)?.state).toBe("running");
  store.update(moved.id, { landing: true });
  dispatch.drain();
  await flush();
  expect(calls).toEqual(["running"]);

  const movedDone = held();
  const movedMerge = dispatch.run(mergeOf(moved.id, "land"), roots, "code", () => { calls.push("moved"); return movedDone.promise; });
  await flush();
  expect(calls).toEqual(["running", "moved"]);

  // The archive merges once the moved Merge job has finished.
  movedDone.release();
  await movedMerge;
  store.writeUnchecked(moved.id, { state: "done", landing: undefined });
  runner.tick();
  await flush();
  expect(calls).toEqual(["running", "moved", "archive"]);
  archiveDone.release();
  await archiveMerge;
});

test("a Merge job behind a queued Deploy does not hold back an archive's merge behind it", async () => {
  const roots = createRootLock();
  const dispatch = dispatchFor(store.waiting);
  const calls: string[] = [];
  const deploy = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  const mergeJob = enqueue({ specFolder: "land", steps: ["land"], branch: "topic" });
  const archive = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
  store.writeUnchecked(archive.id, { state: "done", landing: true });
  const archiveMerge = dispatch.run({ id: `merge:${archive.id}:archive:code`, jobId: archive.id, project: "aide", label: "archive", operation: "archive", reason: "" },
    roots, "code", async () => { calls.push("archive"); });

  // The first pass finds the Merge job held behind the Deploy; the next one lets the archive's merge go.
  const runner = makeRunner({ maxConcurrent: 4 });
  runner.tick();
  runner.tick();
  await archiveMerge;
  expect(calls).toEqual(["archive"]);
  expect(store.get(deploy.id)?.state).toBe("queued");
  expect(store.get(mergeJob.id)?.state).toBe("queued");
});
