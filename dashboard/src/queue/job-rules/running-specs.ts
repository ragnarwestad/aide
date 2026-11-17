import { writing } from "./activity.ts";
import type { Job } from "../types.ts";

type CountedJob = Pick<Job, "id" | "project" | "state" | "landing" | "errorReason">;
export interface SpecActivityCounts { running: number; queued: number }

/** Global Jobs tab totals, independent of the page's filters. */
export function specActivityCounts(jobs: readonly CountedJob[], serves: (project: string) => boolean): SpecActivityCounts {
  const running = new Set<string>();
  const queued = new Set<string>();
  for (const job of jobs) {
    if (!serves(job.project) || ["cancelled", "failed", "stopped", "interrupted"].includes(job.state)) continue;
    const waiting = job.state === "queued" || ((job.state === "running" || job.landing) && job.errorReason === "held-back");
    if (waiting) queued.add(job.id);
    else if (writing(job)) running.add(job.id);
  }
  for (const id of running) queued.delete(id);
  return { running: running.size, queued: queued.size };
}
