import type { QueueStore, WorkflowStep } from "../../../queue/queue.ts";
import { aiWorkRetryRecord } from "../../../queue/runner/retry.ts";
import { endingMayRetry } from "../../../step-endings.ts";

export function retryArchiveLanding(
  queue: Pick<QueueStore, "get" | "transition">,
  jobId: string,
  step: WorkflowStep,
  terminalReason: string,
  detail: string | undefined,
): boolean {
  if (step !== "archive") return false;
  const job = queue.get(jobId);
  if (!job) return false;
  if (!endingMayRetry(terminalReason)) return false;
  const retry = aiWorkRetryRecord(job, "archive", {
    terminalReason,
    ...(detail ? { detail } : {}),
    repos: job.results.at(-1)?.repos,
  });
  return !!retry && queue.transition(jobId, "retry-late", {
    retry,
    finishedAt: undefined,
    error: undefined,
    errorDetail: undefined,
    errorReason: undefined,
    stopReason: undefined,
  }).ok;
}
