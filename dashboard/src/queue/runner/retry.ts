import type { Job } from "../queue.ts";
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
