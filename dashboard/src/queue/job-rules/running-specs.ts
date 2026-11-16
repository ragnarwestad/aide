import { jobKind } from "../steps.ts";
import { writing } from "./activity.ts";
import type { Job } from "../types.ts";

type CountedJob = Pick<Job, "project" | "specFolder" | "steps" | "stepIndex" | "state" | "landing" | "groupMembers">;

export interface SpecActivityCounts { running: number; queued: number }

export function specActivityCounts(jobs: readonly CountedJob[], serves: (project: string) => boolean): SpecActivityCounts {
  const running = new Set<string>();
  const queued = new Set<string>();
  for (const job of jobs) {
    if (!serves(job.project) || (job.state !== "queued" && !writing(job)) || jobKind(job) !== "spec") continue;
    const specs = writing(job) ? running : queued;
    for (const folder of job.groupMembers?.length ? job.groupMembers : [job.specFolder]) specs.add(`${job.project}/${folder}`);
  }
  for (const key of running) queued.delete(key);
  return { running: running.size, queued: queued.size };
}
