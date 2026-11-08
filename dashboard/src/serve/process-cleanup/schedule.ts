import { CLEANUP_KEY, isCleanupJob, UNFINISHED, type QueueStore } from "../../queue/queue.ts";

export const CLEANUP_HOUR = 3;

const sameLocalDate = (stamp: string, now: Date): boolean => {
  const date = new Date(stamp);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

export function enqueueNightlyCleanup(queue: Pick<QueueStore, "list" | "enqueue">, project: string, now = new Date()): boolean {
  const jobs = queue.list().filter((job) => job.project === project && isCleanupJob(job));
  if (jobs.some((job) => UNFINISHED.has(job.state))) return false;
  if (jobs.some((job) => sameLocalDate(job.createdAt, now))) return false;
  return queue.enqueue({ project, specFolder: CLEANUP_KEY, steps: ["cleanup"] }).ok;
}

export function cleanupDue(now: Date): boolean {
  return now.getHours() >= CLEANUP_HOUR;
}
