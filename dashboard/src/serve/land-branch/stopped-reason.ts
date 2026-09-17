// Whether a landing leaves a job's error where it is.

import type { Job } from "../../queue/queue.ts";

/** A step that STOPPED — at its own time limit, or on a provider's
 *  usage limit — lands what it did, and its error is the reason it
 *  stopped: the row's full account of it, not a fault the landing
 *  resolved. Asked of the job as it stands when the landing settles,
 *  since the stop is written before then. */
export function keepsItsStopReason(job: Job | undefined): boolean {
  return job?.state === "stopped" && (job.stopReason === "timeout" || job.stopReason === "provider-limit");
}
