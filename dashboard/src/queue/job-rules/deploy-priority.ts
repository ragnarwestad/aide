import type { Job } from "../types.ts";
import { jobKind } from "../steps.ts";
import type { WaitingEntry } from "../waiting/types.ts";
import { mergeHasItsTurn } from "./merge-order.ts";

export function pendingDeploy(jobs: readonly Job[]): Job | undefined {
  return jobs.find((job) => jobKind(job) === "deploy" && job.state === "running");
}

export function deployBlockingLanding(jobs: readonly Job[], jobId: string): Job | undefined {
  const deploy = pendingDeploy(jobs);
  return deploy && !deploy.deployWaitForLandings?.includes(jobId) ? deploy : undefined;
}

/** Both job starts and root admission use the saved waiting order. */
export function mayAdmit(entry: WaitingEntry, entries: WaitingEntry[], jobs: readonly Job[], admitted: ReadonlySet<string>): boolean {
  if (entry.id.startsWith("merge:") && entry.jobId && admitted.has(entry.jobId)) return true;
  if (!mergeHasItsTurn(entry, entries, jobs, admitted)) return false;
  const running = pendingDeploy(jobs);
  if (entry.id.startsWith("merge:") && running && !running.deployWaitForLandings?.includes(entry.jobId ?? "")) return false;
  const index = entries.findIndex(candidate => candidate.id === entry.id);
  const boundary = entries.findIndex(candidate => candidate.operation === "deploy" &&
    jobs.some(job => job.id === candidate.jobId && job.state === "queued"));
  // A Merge already under way goes on to its repository past a queued
  // deploy: the deploy waits for it, and holding it here would hold both.
  const underWay = entry.id.startsWith("merge:") && jobs.some(job => job.id === entry.jobId && job.landing);
  if (boundary >= 0 && index > boundary && !underWay) return false;
  if (entry.operation === "deploy" && jobs.some(job => job.id === entry.jobId && job.state === "queued")) {
    if (jobs.some(job => job.landing)) return false;
    if (entries.slice(0, index).some(candidate => candidate.id.startsWith("merge:"))) return false;
  }
  return true;
}
