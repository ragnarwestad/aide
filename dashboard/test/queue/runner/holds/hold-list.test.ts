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

test("Land waits only for an active landing and Archive waits for Land (AC-3, AC-4)", () => {
  const archive = enqueue({ steps: ["archive"] });
  store.writeUnchecked(archive.id, { state: "running" });
  const land = enqueue({ specFolder: "land", steps: ["land"], branch: "topic" });
  expect(holdFor(land, context({}))).toBeUndefined();
  store.writeUnchecked(archive.id, { state: "done", landing: true });
  expect(holdFor(land, context({}))?.name).toBe("project-landing");
  store.update(archive.id, { landing: false });
  store.writeUnchecked(land.id, { state: "running", landing: true });
  const laterArchive = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
  expect(holdFor(laterArchive, context({}))?.name).toBe("project-landing");
});


test("a schedule is not held by another spec's running step", () => {
  const scheduled = enqueue({ specFolder: "schedule-nightly", steps: ["schedule"] });
  const running = enqueue({ steps: ["implement"] });
  store.writeUnchecked(running.id, { state: "running" });
  expect(holdFor(scheduled, { ...context({}), maxConcurrent: 2 })).toBeUndefined();
});

test("queued Land branches run one at a time through the end of the landing", () => {
  const first = enqueue({ specFolder: "land", steps: ["land"], branch: "first" });
  store.writeUnchecked(first.id, { state: "running", landing: true });
  const second = enqueue({ specFolder: "land", steps: ["land"], branch: "second" });
  const runner = makeRunner({ maxConcurrent: 4 });
  runner.tick();
  expect(store.get(second.id)?.state).toBe("queued");
  expect(spawns).toHaveLength(0);
  store.writeUnchecked(first.id, { state: "done" });
  runner.tick();
  expect(store.get(second.id)?.state).toBe("queued");
  expect(spawns).toHaveLength(0);
  store.update(first.id, { landing: false });
  runner.tick();
  expect(store.get(second.id)?.state).toBe("running");
  expect(spawns).toHaveLength(1);
});

test("a running Deploy holds new Archive and Land jobs but not Implement", () => {
  const deploy = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  store.writeUnchecked(deploy.id, { state: "running" });
  for (const steps of [["archive"], ["land"]]) {
    const job = enqueue({ specFolder: steps[0] === "land" ? "land" : "91-parallel-spec-runs", steps, branch: "topic" });
    expect(holdFor(job, { ...context({}), maxConcurrent: 10 })?.name).toBe("deploy-priority");
  }
  const implement = enqueue({ steps: ["implement"] });
  expect(holdFor(implement, { ...context({}), maxConcurrent: 10 })).toBeUndefined();
  store.writeUnchecked(deploy.id, { state: "cancelled" });
  const waiting = store.list().find((job) => job.steps[0] === "land")!;
  expect(holdFor(waiting, { ...context({}), maxConcurrent: 10 })).toBeUndefined();
});

test("a Land behind another landing Land names the landing, not the same spec", () => {
  const first = enqueue({ specFolder: "land", steps: ["land"], branch: "one" });
  store.writeUnchecked(first.id, { state: "running", landing: true });
  const second = enqueue({ specFolder: "land", steps: ["land"], branch: "two" });
  expect(holdFor(second, context({}))?.name).toBe("project-landing");
  const spec = enqueue({ steps: ["analyze"] });
  store.writeUnchecked(spec.id, { state: "running" });
  const again = enqueue({ steps: ["implement"] });
  expect(holdFor(again, { ...context({}), maxConcurrent: 2 })?.name).toBe("same-spec-running");
});

test("a group Archive waits while a member's own step is queued, running or waiting on a usage limit", () => {
  const member = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["implement"] });
  const archive = enqueue({ specFolder: "81-queue-and-runner", steps: ["archive"] });
  store.update(archive.id, { groupMembers: ["81-queue-and-runner", "91-parallel-spec-runs"] });
  for (const state of ["queued", "running", "waiting"] as const) {
    store.writeUnchecked(member.id, { state });
    expect(holdFor(store.get(archive.id)!, { ...context({}), maxConcurrent: 4 })?.name).toBe("spec-work-open");
  }
  store.writeUnchecked(member.id, { state: "failed" });
  expect(holdFor(store.get(archive.id)!, { ...context({}), maxConcurrent: 4 })).toBeUndefined();
});

test("an Archive does not wait on a step a usage limit stopped when a newer job for the spec took that step over", () => {
  const stopped = enqueue({ steps: ["analyze", "implement", "archive"] });
  store.writeUnchecked(stopped.id, { state: "waiting", finishedAt: new Date(now - 60_000).toISOString() });
  const archive = enqueue({ steps: ["analyze", "implement", "archive"] });
  store.writeUnchecked(archive.id, { stepIndex: 2, createdAt: new Date(now - 30_000).toISOString() });
  expect(holdFor(store.get(archive.id)!, { ...context({}), maxConcurrent: 4 })).toBeUndefined();
  store.writeUnchecked(archive.id, { createdAt: new Date(now - 90_000).toISOString() });
  expect(holdFor(store.get(archive.id)!, { ...context({}), maxConcurrent: 4 })?.name).toBe("spec-work-open");
});
