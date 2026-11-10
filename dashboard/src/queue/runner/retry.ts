import type { Job, StepRepoRange, WorkflowStep } from "../queue.ts";
import { providerError, type RunnerOptions, type StepOutcome } from "./types.ts";
import { requireWorkflowStep } from "../../workflow-steps.ts";
import { endingMayRetry } from "../../step-endings.ts";
import { endStep } from "./step-result.ts";

export const CAPACITY_RETRY_DELAY_MS = 3 * 60_000;

/** How many attempts one press gets: the first and one automatic retry. */
export const MAX_ATTEMPTS = 2;

/** Which attempt of `step` the job is on: the retry's count when the retry
 *  is for this step, else the first. */
export function attemptOf(job: Pick<Job, "retry">, step: string | undefined): number {
  return job.retry?.action === step ? job.retry.attempts : 1;
}

/** How many more attempts are allowed after attempt `attempt`. */
export function attemptsLeft(attempt: number): number {
  return Math.max(0, MAX_ATTEMPTS - attempt);
}

type RetryInput =
  | { kind: "vanished" | "model-at-capacity" | "other"; attempts: number; now: number }
  | {
      kind: "cli-error";
      providerKind?: "login" | "forbidden" | "network" | "provider" | "other" | "silent";
      attempts: number;
      now: number;
    };

type AiWorkRetryInput = { terminalReason: string; scopeViolation?: "specs" | "analyze" };

export function aiWorkRetryDecision(
  input: AiWorkRetryInput,
  attempts: number,
): { retry: true } | undefined {
  if (attemptsLeft(attempts) === 0) return undefined;
  if (!endingMayRetry(input.terminalReason)) return undefined;
  if (input.terminalReason === "tests-red") return undefined;
  if (input.terminalReason === "scope-violation")
    return input.scopeViolation === "specs" || input.scopeViolation === "analyze" ? { retry: true } : undefined;
  if (input.terminalReason === "cli-error" || input.terminalReason === "model-at-capacity") return undefined;
  return { retry: true };
}

export function aiWorkRetryRecord(
  job: Job,
  action: WorkflowStep,
  evidence: { terminalReason: string; detail?: string; repos?: StepRepoRange[] },
): Job["retry"] | undefined {
  const attempts = attemptOf(job, action);
  if (attemptsLeft(attempts) === 0) return undefined;
  return { action, attempts: attempts + 1, previousAttempt: evidence };
}

export function stepRetryRecord(
  job: Job,
  action: WorkflowStep,
  outcome: Partial<StepOutcome>,
  now: number,
): Job["retry"] | undefined {
  const attempts = attemptOf(job, action);
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
  if (attemptsLeft(input.attempts) === 0) return undefined;
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
  if (!step || requireWorkflowStep(step).runBy === "board") return false;
  const attempts = attemptOf(job, step);
  const decision = retryDecision({
    kind: "vanished",
    attempts,
    now: Date.parse(o.now()),
  });
  if (!decision) return false;
  endStep(o.store, job.id, "retry", {
    retry: {
      action: step,
      attempts: attempts + 1,
      ...(decision.retryAt > Date.parse(o.now())
        ? { dueAt: new Date(decision.retryAt).toISOString() }
        : {}),
    },
    error: undefined,
    errorReason: undefined,
    finishedAt: undefined,
  });
  return true;
}
