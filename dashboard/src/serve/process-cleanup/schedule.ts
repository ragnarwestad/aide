import { CLEANUP_KEY, jobKind, inFlight, type QueueStore } from "../../queue/queue.ts";
import { enqueueRequest } from "../../queue/request/index.ts";

export const CLEANUP_HOUR = 3;

const localDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export const cleanupProject = (projects: Iterable<string>): string | undefined => [...projects].sort()[0];

export function enqueueNightlyCleanup(queue: Pick<QueueStore, "list" | "enqueue" | "update">, projects: Iterable<string>, now = new Date()): boolean {
  const project = cleanupProject(projects);
  if (!project) return false;
  const jobs = queue.list().filter((job) => jobKind(job) === "cleanup");
  if (jobs.some(inFlight)) return false;
  const date = localDate(now);
  if (jobs.some((job) => job.nightlyCleanupDate === date)) return false;
  const result = enqueueRequest(queue, { project, specFolder: CLEANUP_KEY, steps: ["cleanup"] }, "automatic");
  if (!result.ok) return false;
  queue.update(result.job.id, { nightlyCleanupDate: date });
  return true;
}

export function cleanupDue(now: Date): boolean {
  return now.getHours() >= CLEANUP_HOUR;
}
