import { jobKind, type Job, type JobPatch, type QueueStore, type TransitionResult } from "../queue.ts";
import { automaticProviderWait } from "../job-rules/activity.ts";
import { endStep } from "../runner/step-result.ts";

export const scheduleCancellationFields = {
  usageLimitWait: undefined, usageLimitProbe: undefined, retry: undefined,
  stopReason: undefined, error: undefined, errorReason: undefined, errorDetail: undefined,
} satisfies JobPatch;

export function canCancelScheduleWait(job: Pick<Job, "steps" | "stepIndex" | "specFolder" | "state" | "stopReason" | "usageLimitWait" | "landing">): boolean {
  return jobKind(job) === "schedule" && !job.landing && automaticProviderWait(job);
}

/** The sentences `usageLimitHolds` holds a queued job with. */
const USAGE_LIMIT_HOLDS = new Set(["runner.usageLimitHeld", "runner.usageLimitHeldNoReset", "runner.usageLimitHeldProbe"]);

/** A scheduled job still queued because its provider's usage limit holds it
 *  back: the runner writes the hold's sentence on the job each tick. */
export function heldByUsageLimit(job: Pick<Job, "steps" | "stepIndex" | "specFolder" | "state" | "landing" | "error" | "errorReason">): boolean {
  const key = job.error && typeof job.error === "object" && !Array.isArray(job.error) ? job.error.key : undefined;
  return jobKind(job) === "schedule" && !job.landing && job.state === "queued" && job.errorReason === "held-back" &&
    typeof key === "string" && USAGE_LIMIT_HOLDS.has(key);
}

/** Whether the schedule's next run, once due, ends this attempt as failed:
 *  a quota wait, or a queued attempt a usage limit still holds back. */
export function canReplaceScheduleWait(job: Job): boolean {
  return canCancelScheduleWait(job) || heldByUsageLimit(job);
}

/** A quota wait, or a held-back attempt, its schedule's next run overtook:
 *  the attempt did not run, so it fails, and nobody cancelled it. */
export function replaceScheduleWait(store: QueueStore, job: Job, now = Date.now()): TransitionResult {
  if (!canReplaceScheduleWait(job)) return { ok: false, state: job.state, event: "replace-schedule-wait" };
  return endStep(store, job.id, "replace-schedule-wait", {
    ...scheduleCancellationFields, error: { key: "runner.scheduleWaitReplaced" }, finishedAt: new Date(now).toISOString(),
  });
}

export function cancelScheduleWait(store: QueueStore, job: Job, now = Date.now()): TransitionResult {
  if (!canCancelScheduleWait(job)) return { ok: false, state: job.state, event: "cancel-schedule-wait" };
  return endStep(store, job.id, "cancel-schedule-wait", {
    ...scheduleCancellationFields, finishedAt: new Date(now).toISOString(),
  });
}
