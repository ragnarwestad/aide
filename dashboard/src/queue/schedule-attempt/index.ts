import { jobKind, type Job, type QueueStore, type TransitionResult } from "../queue.ts";
import { automaticProviderWait } from "../job-rules/activity.ts";
import { endStep } from "../runner/step-result.ts";

export const scheduleCancellationFields = {
  usageLimitWait: undefined, usageLimitProbe: undefined, retry: undefined,
  stopReason: undefined, error: undefined, errorReason: undefined, errorDetail: undefined,
} satisfies Partial<Job>;

export function canCancelScheduleWait(job: Pick<Job, "steps" | "stepIndex" | "specFolder" | "state" | "stopReason" | "usageLimitWait" | "landing">): boolean {
  return jobKind(job) === "schedule" && !job.landing && automaticProviderWait(job);
}

/** A quota wait its schedule's next run overtook: the attempt did not run,
 *  so it fails, and nobody cancelled it. */
export function replaceScheduleWait(store: QueueStore, job: Job, now = Date.now()): TransitionResult {
  if (!canCancelScheduleWait(job)) return { ok: false, state: job.state, event: "replace-schedule-wait" };
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
