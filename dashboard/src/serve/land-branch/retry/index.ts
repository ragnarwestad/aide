import type { Sentence } from "../../../i18n/message.ts";
import type { QueueStore, WorkflowStep } from "../../../queue/queue.ts";
import { aiWorkRetryDecision, aiWorkRetryRecord } from "../../../queue/runner/retry.ts";

function hasKey(sentence: Sentence | Sentence[] | undefined, prefix: string): boolean {
  if (Array.isArray(sentence)) return sentence.some((entry) => hasKey(entry, prefix));
  return !!sentence && typeof sentence !== "string" &&
    (sentence.key.startsWith(prefix) || hasKey(sentence.inner, prefix));
}

export function retryArchiveLanding(
  queue: Pick<QueueStore, "get" | "transition">,
  jobId: string,
  step: WorkflowStep,
  held: boolean,
  failure: Sentence,
  detail: string | undefined,
): boolean {
  if (step !== "archive") return false;
  const job = queue.get(jobId);
  if (!job) return false;
  const lateCheck = held ? "archive-tests-red" : hasKey(failure, "landing.testsTimedOut")
    ? "archive-tests-timeout" : undefined;
  const attempts = job.retry?.action === "archive" ? job.retry.attempts : 1;
  if (!lateCheck || !aiWorkRetryDecision({ lateCheck }, attempts)) return false;
  const retry = aiWorkRetryRecord(job, "archive", {
    terminalReason: lateCheck,
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
