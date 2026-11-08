import { providerError, type StepOutcome } from "./types.ts";

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
