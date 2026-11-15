import { jobKind } from "../steps.ts";
import { writing } from "./activity.ts";
import type { Job } from "../types.ts";

type CountedJob = Pick<Job, "project" | "specFolder" | "steps" | "stepIndex" | "state" | "landing" | "groupMembers">;

export function runningSpecCount(jobs: readonly CountedJob[], serves: (project: string) => boolean): number {
  const specs = new Set<string>();
  for (const job of jobs) {
    if (!serves(job.project) || !writing(job) || jobKind(job) !== "spec") continue;
    for (const folder of job.groupMembers?.length ? job.groupMembers : [job.specFolder]) specs.add(`${job.project}/${folder}`);
  }
  return specs.size;
}
