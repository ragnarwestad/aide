// A landing's merge step marks itself started before it asks for the
// repository's merge lock. While the queue holds that merge waiting for the
// lock, the step is queued, not running.

import { expect, test } from "bun:test";
import { WaitingQueue } from "../../../src/queue/waiting";
import { queuedWhileMergeWaits } from "../../../src/queue/waiting/jobs.ts";
import type { StepMark } from "../../../src/queue/parse-stream";

const marks = (): StepMark[] => [
  { key: "Step Aide: tests and commit", title: "Tests and commit", state: "done" },
  { key: "Step 5 of 5", title: "Test and merge code and spec files into main", state: "running" },
];

test("the running merge step is queued while its merge waits for the lock", () => {
  const waiting = new WaitingQueue({});
  waiting.pending.set("merge:job-1:archive:/repo", { id: "merge:job-1:archive:/repo", jobId: "job-1", project: "aide", label: "b", operation: "archive", reason: "Waiting for the repository merge lock" });
  expect(queuedWhileMergeWaits(marks(), waiting, "job-1").map((m) => m.state)).toEqual(["done", "queued"]);
});

test("the merge step runs once its merge has the lock, and another job's wait changes nothing", () => {
  const waiting = new WaitingQueue({});
  expect(queuedWhileMergeWaits(marks(), waiting, "job-1").map((m) => m.state)).toEqual(["done", "running"]);
  waiting.pending.set("merge:job-2:archive:/repo", { id: "merge:job-2:archive:/repo", jobId: "job-2", project: "aide", label: "b", operation: "archive", reason: "Waiting for the repository merge lock" });
  expect(queuedWhileMergeWaits(marks(), waiting, "job-1").map((m) => m.state)).toEqual(["done", "running"]);
});
