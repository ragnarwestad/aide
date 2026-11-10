/** Whether a job is waiting, running, landing, or settled. Kept free of
 * server imports so browser controls can use the queue's rule directly. */
export type JobActivity = "queued" | "running" | "landing" | "idle";

export function jobActivity(job: { state: string; landing?: boolean }): JobActivity {
  if (job.landing) return "landing";
  return job.state === "running" || job.state === "queued" ? job.state : "idle";
}

export const inFlight = (job: { state: string; landing?: boolean }): boolean => jobActivity(job) !== "idle";

export const writing = (job: { state: string; landing?: boolean }): boolean => {
  const activity = jobActivity(job);
  return activity === "running" || activity === "landing";
};
