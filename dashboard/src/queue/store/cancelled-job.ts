// Cancelled schedules keep their records so the same fire is not queued
// again. Other jobs with no run, log, cost or result are removed.
// Every cancel logs the job, its state and what it was waiting for.

import { jobKind } from "../steps.ts";
import { formatSentence } from "../../messages/format.ts";
import type { Job } from "../queue.ts";

/** A cancelled schedule keeps its record so the same fire is not queued again. */
export function discardOnCancel(job: Job): boolean {
  return jobKind(job) !== "schedule" && !job.startedAt && job.results.length === 0 && !job.landing;
}

/** The line a cancel leaves, from the job as it was the moment before. */
export function cancelLine(before: Job, removed: boolean): string {
  const waiting = before.errorReason === "held-back" && before.error && !Array.isArray(before.error) && typeof before.error === "object"
    ? ` — it was waiting: ${formatSentence("en", before.error)} (${before.error.key})`
    : "";
  return `queue: cancelled ${before.project}/${before.specFolder} (job ${before.id.slice(0, 8)}) while ${before.state}${waiting}` +
    (removed ? " — removed, since it never started" : "");
}
