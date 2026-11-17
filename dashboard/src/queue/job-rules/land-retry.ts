import type { Job } from "../types.ts";

type Attempt = Pick<Job, "id" | "project" | "steps" | "branch" | "state" | "landing">;

/** Queue history is newest first, including attempts made in the same millisecond. */
export function landSuccessor(job: Attempt, history: readonly Attempt[]): { id: string; landed: boolean } | undefined {
  if (job.steps[0] !== "land" || !job.branch) return undefined;
  const index = history.findIndex((candidate) => candidate.id === job.id);
  if (index < 0) return undefined;
  const newer = history.slice(0, index).find((candidate) => candidate.project === job.project &&
    candidate.steps[0] === "land" && candidate.branch === job.branch);
  return newer ? { id: newer.id, landed: newer.state === "done" && !newer.landing } : undefined;
}
