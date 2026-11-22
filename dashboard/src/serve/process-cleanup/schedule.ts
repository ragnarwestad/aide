import { CLEANUP_KEY, jobKind, inFlight, type QueueStore } from "../../queue/queue.ts";
import { enqueueRequest } from "../../queue/request/index.ts";

export const CLEANUP_HOUR = 3;

const localDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The project the board-wide cleanup job is filed under: the first shown
 *  one by name, since the queue takes no job for a hidden project. */
export const cleanupProject = (projects: Iterable<string>, hidden: ReadonlySet<string> = new Set()): string | undefined =>
  [...projects].filter((p) => !hidden.has(p)).sort()[0];

export function enqueueNightlyCleanup(
  queue: Pick<QueueStore, "list" | "enqueue" | "update">, projects: Iterable<string>, now = new Date(), hidden: ReadonlySet<string> = new Set(),
): boolean {
  const project = cleanupProject(projects, hidden);
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
