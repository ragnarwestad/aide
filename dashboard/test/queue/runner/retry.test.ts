import { describe, expect, test } from "bun:test";
import { retryDecision } from "../../../src/queue/runner/retry.ts";

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
