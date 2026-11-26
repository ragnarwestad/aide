import { expect, test } from "bun:test";
import { mergeHasItsTurn } from "../../../src/queue/job-rules/merge-order.ts";
import type { Job } from "../../../src/queue/types.ts";
import type { WaitingEntry } from "../../../src/queue/waiting/types.ts";

const job = (id: string, overrides: Partial<Job> = {}): Job => ({
  id, project: "aide", specFolder: id, state: "queued", steps: ["land"], stepIndex: 0,
  createdAt: "2026-11-26T09:00:00Z", results: [], ...overrides,
} as Job);
const queued = (j: Job): WaitingEntry => ({ id: `job:${j.id}:0`, jobId: j.id, project: j.project, label: j.id, operation: "land", reason: "" });
const merge = (j: Job, operation: string): WaitingEntry =>
  ({ id: `merge:${j.id}:${operation}:/code`, jobId: j.id, project: j.project, label: j.id, operation, reason: "" });

const mergeJob = job("merge-job");
const archive = job("archive", { state: "done", landing: true, steps: ["archive"] });

test("an archive's merge waits for a Merge job ahead of it, and goes when it stands ahead", () => {
  const behind = [queued(mergeJob), merge(archive, "archive")];
  expect(mergeHasItsTurn(behind[1]!, behind, [mergeJob, archive], new Set())).toBe(false);
  const ahead = [merge(archive, "archive"), queued(mergeJob)];
  expect(mergeHasItsTurn(ahead[0]!, ahead, [mergeJob, archive], new Set())).toBe(true);
});

test("only a project's own Merge jobs and archives wait for their turn", () => {
  const analyze = job("analyze", { state: "done", landing: true, steps: ["analyze", "implement"] });
  const spec = [queued(mergeJob), merge(analyze, "analyze")];
  expect(mergeHasItsTurn(spec[1]!, spec, [mergeJob, analyze], new Set())).toBe(true);
  const elsewhere = job("paceup-archive", { project: "paceup", state: "done", landing: true, steps: ["archive"] });
  const other = [queued(mergeJob), merge(elsewhere, "archive")];
  expect(mergeHasItsTurn(other[1]!, other, [mergeJob, elsewhere], new Set())).toBe(true);
});

test("a Merge job held for something other than its turn holds no merge behind it", () => {
  const later = job("later", { retry: { dueAt: new Date(Date.now() + 60_000).toISOString() } as Job["retry"] });
  const afterDeploy = job("after-deploy", { errorReason: "held-back", error: { key: "runner.deployPriority" } });
  const inTurn = job("in-turn", { errorReason: "held-back", error: { key: "runner.archiveRunning" } });
  for (const [ahead, holds] of [[later, false], [afterDeploy, false], [inTurn, true]] as const) {
    const entries = [queued(ahead), merge(archive, "archive")];
    expect(mergeHasItsTurn(entries[1]!, entries, [ahead, archive], new Set())).toBe(!holds);
  }
});

test("one merge at a time: an archive waits while another merge in its project has its turn", () => {
  const merging = job("merging", { state: "running", landing: true });
  const entries = [merge(archive, "archive")];
  expect(mergeHasItsTurn(entries[0]!, entries, [merging, archive], new Set(["merging"]))).toBe(false);
  expect(mergeHasItsTurn(entries[0]!, entries, [merging, archive], new Set())).toBe(true);
});
