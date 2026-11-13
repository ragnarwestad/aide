// What becomes of a cancelled job: one that never started holds nothing
// worth keeping — no log, no cost, no result — and cannot be started
// again, so it is removed. Either way the cancel leaves one line saying
// which job, in which state, and what it was waiting for.

import { formatSentence } from "../../messages/format.ts";
import type { Job } from "../queue.ts";

/** A job with nothing to show for itself: no step ever started, and no
 *  landing of its own. */
export function neverStarted(job: Job): boolean {
  return !job.startedAt && job.results.length === 0 && !job.landing;
}

/** The line a cancel leaves, from the job as it was the moment before. */
export function cancelLine(before: Job, removed: boolean): string {
  const waiting = before.errorReason === "held-back" && before.error && !Array.isArray(before.error) && typeof before.error === "object"
    ? ` — it was waiting: ${formatSentence("en", before.error)} (${before.error.key})`
    : "";
  return `queue: cancelled ${before.project}/${before.specFolder} (job ${before.id.slice(0, 8)}) while ${before.state}${waiting}` +
    (removed ? " — removed, since it never started" : "");
}
