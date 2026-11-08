import type { Job, StepRepoRange, WorkflowStep } from "../queue.ts";
import { providerError, type RunnerOptions, type StepOutcome } from "./types.ts";

export const CAPACITY_RETRY_DELAY_MS = 3 * 60_000;

type RetryInput =
  | { kind: "vanished" | "model-at-capacity" | "other"; attempts: number; now: number }
  | {
      kind: "cli-error";
      providerKind?: "login" | "forbidden" | "network" | "provider" | "other" | "silent";
      attempts: number;
      now: number;
    };

type AiWorkRetryInput =
  | { terminalReason: string; scopeViolation?: "specs" | "analyze"; lateCheck?: never }
  | { terminalReason?: never; lateCheck: "overlap-decision-missing" | "archive-tests-red" | "archive-tests-timeout" };

export function aiWorkRetryDecision(
  input: AiWorkRetryInput,
  attempts: number,
): { retry: true } | undefined {
  if (attempts >= 2) return undefined;
  if (input.lateCheck) return { retry: true };
  if (input.terminalReason === "scope-violation")
    return input.scopeViolation === "specs" || input.scopeViolation === "analyze" ? { retry: true } : undefined;
  if (["no-progress", "merge-unfinished", "timeout"].includes(input.terminalReason))
    return { retry: true };
  return undefined;
}

export function aiWorkRetryRecord(
  job: Job,
  action: WorkflowStep,
  evidence: { terminalReason: string; detail?: string; repos?: StepRepoRange[] },
): Job["retry"] | undefined {
  const attempts = job.retry?.action === action ? job.retry.attempts : 1;
  if (attempts >= 2) return undefined;
  return { action, attempts: attempts + 1, previousAttempt: evidence };
}

export function stepRetryRecord(
  job: Job,
  action: WorkflowStep,
  outcome: Partial<StepOutcome>,
  now: number,
): Job["retry"] | undefined {
  const attempts = job.retry?.action === action ? job.retry.attempts : 1;
  const transient = outcomeRetryDecision(outcome, attempts, now);
  const aiWork = outcome.terminalReason
    ? aiWorkRetryDecision({ terminalReason: outcome.terminalReason, scopeViolation: outcome.scopeViolation }, attempts)
    : undefined;
  if (!transient && !aiWork) return undefined;
  return {
    action,
    attempts: attempts + 1,
    ...(transient && transient.retryAt > now ? { dueAt: new Date(transient.retryAt).toISOString() } : {}),
    ...(aiWork ? { previousAttempt: {
      terminalReason: outcome.terminalReason!,
      ...(typeof (outcome.errorLog ?? outcome.error) === "string" ? { detail: outcome.errorLog ?? outcome.error } : {}),
      ...(Array.isArray(outcome.repos) ? { repos: outcome.repos } : {}),
    } } : {}),
  };
}

export function retryDecision(input: RetryInput): { retryAt: number } | undefined {
  if (input.attempts >= 2) return undefined;
  if (input.kind === "vanished") return { retryAt: input.now };
  if (input.kind === "model-at-capacity")
    return { retryAt: input.now + CAPACITY_RETRY_DELAY_MS };
  if (
    input.kind === "cli-error" &&
    ["network", "provider", "other", "silent"].includes(input.providerKind ?? "")
  )
    return { retryAt: input.now };
  return undefined;
}

export function outcomeRetryDecision(
  outcome: Partial<StepOutcome>,
  attempts: number,
  now: number,
): { retryAt: number } | undefined {
  if (outcome.terminalReason === "model-at-capacity")
    return retryDecision({ kind: "model-at-capacity", attempts, now });
  if (outcome.terminalReason !== "cli-error") return undefined;
  return retryDecision({
    kind: "cli-error",
    providerKind: providerError(outcome.providerError)?.kind,
    attempts,
    now,
  });
}

/** Persist the automatic second attempt before returning it to the queue. */
export function queueVanishedRetry(o: RunnerOptions, job: Job): boolean {
  const step = job.steps[job.stepIndex];
  if (!step || step === "deploy") return false;
  const attempts = job.retry?.action === step ? job.retry.attempts : 1;
  const decision = retryDecision({
    kind: "vanished",
    attempts,
    now: Date.parse(o.now()),
  });
  if (!decision) return false;
  o.store.transition(job.id, "retry", {
    retry: {
      action: step,
      attempts: attempts + 1,
      ...(decision.retryAt > Date.parse(o.now())
        ? { dueAt: new Date(decision.retryAt).toISOString() }
        : {}),
    },
    pid: undefined,
    pgid: undefined,
    resultFile: undefined,
    sessionId: undefined,
    streamFile: undefined,
    stepStartedAt: undefined,
    error: undefined,
    errorReason: undefined,
    finishedAt: undefined,
  });
  return true;
}
