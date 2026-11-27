// A job's state moves only through `QueueStore.transition`, and the
// compiler holds that boundary: `update` and `transition` take a
// `JobPatch`, which cannot carry `state`, and `Job.state` is readonly.
// The examples below are type-checked by `tsc --noEmit` and never run:
// each forbidden write sits under `@ts-expect-error`, so the check goes
// red the moment one of them stops being an error, and each permitted
// write of another model's `state` sits plain, so it goes red the
// moment the boundary starts catching models that are not a job's.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type Job, type JobPatch, type JobState, type QueueDefaults } from "../../../src/queue/queue.ts";
import type { StepMark } from "../../../src/queue/parse-stream/step-marks.ts";

/** A store of another model, with a `state` its words share with a job's. */
class BoardStore {
  update(_id: string, _patch: { status?: "starting" | "running" | "failed"; state?: "running" | "failed" }): void {}
}

// Type-checked only: forbidden writes to a job's state, whatever the
// store is called.
export function forbiddenJobStateWrites(queue: QueueStore, job: Job, next: JobState, patch: Partial<Job>): void {
  // @ts-expect-error a literal state through update
  queue.update(job.id, { state: "failed" });
  // @ts-expect-error a state held in a variable
  queue.update(job.id, { state: next });
  // @ts-expect-error a spread of a patch that may carry state
  queue.update(job.id, { error: "e", ...patch });
  // @ts-expect-error a Partial<Job> handed over whole
  queue.update(job.id, patch);
  const state = next;
  // @ts-expect-error a shorthand state through transition
  queue.transition(job.id, "cancel", { state });
  // @ts-expect-error assigning a job's state
  job.state = "done";

  const jobs: QueueStore = queue;
  // @ts-expect-error the same write through a store under another name
  jobs.update(job.id, { state: "failed" });
  // @ts-expect-error the same transition through a store under another name
  jobs.transition(job.id, "start", { state: next });
}

// Type-checked only: another model's `state`, with the words a job's
// state uses, is not a job write.
export function permittedUnrelatedStateWrites(queue: QueueStore, mark: StepMark, board: BoardStore, job: Job): void {
  queue.executionGroups.update("group-1", { state: "running" });
  queue.executionGroups.update("group-1", { state: "queued" });
  const entry: { status: "failed"; state: "running" } = { status: "failed", state: "running" };
  board.update("aide/150-x", entry);
  mark.state = "failed";
  const sort: { state: "asc" | "desc" } = { state: "asc" };
  sort.state = "desc";
  const nested: JobPatch & { meta?: { state: JobState } } = { error: "e", meta: { state: "failed" } };
  queue.update(job.id, nested);
}

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

function makeStore(): QueueStore {
  const dir = mkdtempSync(join(tmpdir(), "aide-state-ownership-"));
  return new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: DEFAULTS,
    resolve: (project) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null),
  });
}

describe("the raw write a test seeds a job's state through", () => {
  test("writeUnchecked sets the state, and a later update keeps it (AC-1, AC-4)", () => {
    const store = makeStore();
    const r = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    expect(store.writeUnchecked(r.job.id, { state: "running" })?.state).toBe("running");
    store.update(r.job.id, { error: "e" });
    expect(store.get(r.job.id)).toMatchObject({ state: "running", error: "e" });
  });

  test("an update that names state, even as undefined, leaves the job's state as it was (AC-1)", () => {
    const store = makeStore();
    const r = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    store.update(r.job.id, { state: undefined, error: "e" });
    expect(store.get(r.job.id)).toMatchObject({ state: "queued", error: "e" });
  });

});
