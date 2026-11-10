// The holds a queued job can wait on are one ordered list, each with its own
// name: the first that applies is the one its row names.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BoardMessage } from "../../../../src/messages/types.ts";
import { HOLD_NAMES, HOLDS, holdFor } from "../../../../src/queue/runner/holds.ts";
import { cleanupHarness, enqueue, makeRunner, now, resetHarness, spawns, store } from "../runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const one = (id: string, message: BoardMessage) => new Map([[id, message]]);
const switchedOff: BoardMessage = { key: "runner.providerSwitchedOff", values: { provider: "Claude" } };
const usageLimit: BoardMessage = { key: "runner.usageLimitHeld", values: { tool: "claude", at: "2026-08-16T14:00:00.000Z" } };
const keyOf = (id: string) => (store.get(id)?.error as { key?: string } | undefined)?.key;
const context = (answers: Parameters<typeof holdFor>[1]["answers"]) => ({
  jobs: () => store.list(), maxConcurrent: 1, now: new Date(now).toISOString(), answers,
});

describe("the hold list", () => {
  test("names every hold once, in the order tick asks them (AC-3)", () => {
    expect(HOLDS.map((hold) => hold.name)).toEqual([...HOLD_NAMES]);
    expect(new Set(HOLD_NAMES).size).toBe(HOLD_NAMES.length);
  });

  test("a switched-off provider wins over a usage limit; a usage limit alone holds with its own sentence (AC-3)", () => {
    const both = enqueue({ steps: ["implement"] });
    const limited = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["implement"] });
    const answers = { switchedOff: one(both.id, switchedOff), usageLimit: new Map([[both.id, usageLimit], [limited.id, usageLimit]]) };
    expect(holdFor(store.get(both.id)!, context(answers))?.name).toBe("provider-switched-off");
    expect(holdFor(store.get(limited.id)!, context(answers))?.name).toBe("usage-limit");
    makeRunner({ maxConcurrent: 2 }).tick(answers);
    expect(keyOf(both.id)).toBe("runner.providerSwitchedOff");
    expect(keyOf(limited.id)).toBe("runner.usageLimitHeld");
    expect(spawns).toHaveLength(0);
  });

  test("not analyzed wins over a choice of approach (AC-3)", () => {
    const job = enqueue({ steps: ["implement"] });
    const answers = { notAnalyzed: one(job.id, { key: "runner.notAnalyzed" }), approachChoice: one(job.id, { key: "runner.approachChoice" }) };
    expect(holdFor(store.get(job.id)!, context(answers))?.name).toBe("not-analyzed");
    makeRunner().tick(answers);
    expect(keyOf(job.id)).toBe("runner.notAnalyzed");
    expect(spawns).toHaveLength(0);
  });

  test("a job no hold applies to is named by none, and starts (AC-3)", () => {
    const job = enqueue({ steps: ["implement"] });
    expect(holdFor(store.get(job.id)!, context({}))).toBeUndefined();
    makeRunner().tick({});
    expect(store.get(job.id)?.state).toBe("running");
  });
});


test("a schedule is not held by another spec's running step", () => {
  const scheduled = enqueue({ specFolder: "schedule-nightly", steps: ["schedule"] });
  const running = enqueue({ steps: ["implement"] });
  store.update(running.id, { state: "running" });
  expect(holdFor(scheduled, { ...context({}), maxConcurrent: 2 })).toBeUndefined();
});
