import type { Job } from "../types.ts";
import { jobKind } from "../steps.ts";
import { inFlight } from "./activity.ts";

export function pendingDeploy(jobs: readonly Job[]): Job | undefined {
  return jobs.find((job) => jobKind(job) === "deploy" && inFlight(job));
}

export function deployBlockingLanding(jobs: readonly Job[], jobId: string): Job | undefined {
  const deploy = pendingDeploy(jobs);
  return deploy && !deploy.deployWaitForLandings?.includes(jobId) ? deploy : undefined;
}

export function captureDeployPriority(job: Job, jobs: readonly Job[]): void {
  if (jobKind(job) === "deploy") job.deployWaitForLandings = jobs.filter((other) => other.landing).map((other) => other.id);
}
