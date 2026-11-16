// The states a job passes through, and the reasons something stands in
// its way: one list each, read by the queue, the pages and the mirror
// reader alike.

export const JOB_STATES = [
  "queued", "running", "done",
  "stopped", "failed", "cancelled", "interrupted",
] as const;
export type JobState = (typeof JOB_STATES)[number];
export const isJobState = (value: unknown): value is JobState =>
  typeof value === "string" && (JOB_STATES as readonly string[]).includes(value);

export const ERROR_REASONS = ["conflict", "held-back", "tests-red", "unlanded"] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number];
export const isErrorReason = (value: unknown): value is ErrorReason =>
  typeof value === "string" && (ERROR_REASONS as readonly string[]).includes(value);
