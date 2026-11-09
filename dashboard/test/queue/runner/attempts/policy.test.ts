import { describe, expect, test } from "bun:test";
import { aiWorkRetryDecision, retryDecision } from "../../../../src/queue/runner/retry.ts";

describe("retryDecision", () => {
  test("retries vanished runs and eligible provider failures once (AC-1, AC-3, AC-10)", () => {
    expect(retryDecision({ kind: "vanished", attempts: 1, now: 1_000 })).toEqual({
      retryAt: 1_000,
    });
    expect(
      retryDecision({ kind: "cli-error", providerKind: "network", attempts: 1, now: 1_000 }),
    ).toEqual({ retryAt: 1_000 });
    expect(retryDecision({ kind: "vanished", attempts: 2, now: 1_000 })).toBeUndefined();
  });

  test("waits a few minutes before retrying a model at capacity (AC-2)", () => {
    expect(retryDecision({ kind: "model-at-capacity", attempts: 1, now: 1_000 })).toEqual({
      retryAt: 181_000,
    });
  });

  test("does not retry failures that need a person first (AC-9)", () => {
    expect(
      retryDecision({ kind: "cli-error", providerKind: "login", attempts: 1, now: 1_000 }),
    ).toBeUndefined();
    expect(
      retryDecision({ kind: "cli-error", providerKind: "forbidden", attempts: 1, now: 1_000 }),
    ).toBeUndefined();
    expect(retryDecision({ kind: "other", attempts: 1, now: 1_000 })).toBeUndefined();
  });
});

describe("aiWorkRetryDecision", () => {
  test("retries AI-work endings and time limits once (AC-1, AC-2, AC-3, AC-6, AC-9)", () => {
    for (const terminalReason of ["no-progress", "merge-unfinished", "timeout"]) {
      expect(aiWorkRetryDecision({ terminalReason }, 1)).toEqual({ retry: true });
      expect(aiWorkRetryDecision({ terminalReason }, 2)).toBeUndefined();
    }
    expect(aiWorkRetryDecision({ terminalReason: "scope-violation", scopeViolation: "specs" }, 1)).toEqual({ retry: true });
  });

  test("retries eligible semantic reasons through the same cap (AC-4)", () => {
    expect(aiWorkRetryDecision({ terminalReason: "no-progress" }, 1)).toEqual({ retry: true });
    expect(aiWorkRetryDecision({ terminalReason: "overlap-decision-missing" }, 1)).toEqual({ retry: true });
    expect(aiWorkRetryDecision({ terminalReason: "overlap-decision-missing" }, 2)).toBeUndefined();
    expect(aiWorkRetryDecision({ terminalReason: "tests-red" }, 1)).toBeUndefined();
  });

  test("does not retry failures that require a person or the machinery first (AC-9)", () => {
    expect(aiWorkRetryDecision({ terminalReason: "tests-not-started" }, 1)).toBeUndefined();
    expect(aiWorkRetryDecision({ terminalReason: "cli-error" }, 1)).toBeUndefined();
  });
});
