import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cleanupHarness,
  enqueue,
  makeRunner,
  resetHarness,
  setNow,
  spawns,
  store,
} from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

describe("automatic step retries", () => {
  test("restarts a vanished run once and persists the cap (AC-1, AC-10)", () => {
    const job = enqueue();
    const runner = makeRunner({ alive: () => false });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("queued");
    expect(store.get(job.id)?.retry).toEqual({ action: "analyze", attempts: 2 });

    runner.tick();
    runner.poll();
    expect(spawns).toHaveLength(2);
    expect(store.get(job.id)?.state).toBe("interrupted");
  });

  test("does not occupy a slot while a capacity retry waits (AC-2, AC-3)", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ok: false, terminalReason: "model-at-capacity", costUsd: 0 }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("queued");
    runner.tick();
    expect(spawns).toHaveLength(1);
    setNow(Date.parse("2026-08-16T10:03:00Z"));
    runner.tick();
    expect(spawns).toHaveLength(2);
  });

  test("a later press gets a fresh retry allowance (AC-10)", () => {
    const first = enqueue();
    const second = enqueue({ specFolder: "91-parallel-spec-runs" });
    expect(first.retry).toBeUndefined();
    expect(second.retry).toBeUndefined();
  });
});
