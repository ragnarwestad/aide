// How many test workers a run may use: the host's cores divided among the
// steps and landings running at this moment, rounded down and at least one.
// `test_workers_share` (core/scripts/lib/run-spec/turn/test-workers.sh)
// makes the same decision for a step's own runs;
// core/tests/fixtures/test-workers.json pins both.
import type { Job } from "./types.ts";

export type BusyJob = Pick<Job, "state" | "landing">;

export function testWorkerShare(cores: number, jobs: readonly BusyJob[]): number {
  const busy = jobs.filter((j) => j.state === "running" || j.landing === true).length;
  return Math.max(1, Math.floor(cores / Math.max(1, busy)));
}
