// Split out of runner.test.ts by theme.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dir, events, spawns, store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

// Spec 118: what a step actually METERED, beside what it cost. On a
// subscription plan the dollar figure is notional and this is the number
// the plan bills against.
describe("a step's token usage", () => {
  const withTokens = (cost: number, total: number) => ({
    ...okResult(cost),
    tokens: { input: 10, output: 90, cacheRead: 500, cacheCreation: 400, total },
  });

  test("a result carrying tokens records them on the step", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => withTokens(1, 1000) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.results[0]?.tokens).toEqual({
      input: 10, output: 90, cacheRead: 500, cacheCreation: 400, total: 1000,
    });
  });

  test("the job's own total is the sum over its steps, like the cost", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => withTokens(1, 1000) });
    runner.tick();
    runner.poll();
    runner.tick();
    runner.poll();
    const after = store.get(job.id)!;
    expect(after.spentUsd).toBeCloseTo(2);
    expect(after.spentTokens).toBe(2000);
  });

  test("the day's token total accumulates beside the day's cost", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => withTokens(1, 1000) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("done");
    expect(runner.spentTokensToday()).toBe(1000);
  });

  test("a day boundary clears the token total too", () => {
    const runner = makeRunner();
    runner.addSpentTokensToday(4000);
    expect(runner.spentTokensToday()).toBe(4000);
    runner.setToday("2026-08-17");
    expect(runner.spentTokensToday()).toBe(0);
  });
});

describe("reconciliation after a restart", () => {
  const runningJob = () => {
    const job = enqueue();
    store.update(job.id, {
      state: "running",
      pid: 4242,
      pgid: 4242,
      resultFile: join(dir, `${job.id}.json`),
      startedAt: "2026-08-16T09:00:00Z",
    });
    return job;
  };

  test("pid alive → the job is still running and is NOT restarted", () => {
    const job = runningJob();
    const runner = makeRunner({ alive: () => true });
    runner.reconcile();
    expect(store.get(job.id)?.state).toBe("running");
    runner.tick();
    expect(spawns.length).toBe(0);
  });

  test("pid gone with a result file → the step is completed from the file", () => {
    const job = runningJob();
    writeFileSync(join(dir, `${job.id}.json`), JSON.stringify(okResult(2)));
    const runner = makeRunner({
      alive: () => false,
      readResult: (path) => JSON.parse(require("node:fs").readFileSync(path, "utf-8")),
    });
    runner.reconcile();
    const after = store.get(job.id)!;
    expect(after.state).toBe("done");
    expect(after.spentUsd).toBeCloseTo(2);
  });

  test("pid gone with no result file → interrupted, the one honest 'we do not know'", () => {
    const job = runningJob();
    const runner = makeRunner({ alive: () => false, readResult: () => null });
    runner.reconcile();
    expect(store.get(job.id)?.state).toBe("interrupted");
    // Spec 385 (REQ-4): the STATE transition above is only half of what
    // the job's own row needs — the rendered "the server restarted while
    // this step was running..." sentence is drawn from this `error`
    // field, which this test used to leave unasserted.
    // The message names the row's own button: the phase this job was on.
    expect(store.get(job.id)?.error).toEqual({ key: "runner.serverRestarted", values: { button: "Analyze" } });
  });
});

describe("notifications (criterion 7)", () => {
  // Spec 149. A gate parked a job between two steps and waited for a
  // person to press Approve. There is no stop between steps any more —
  // every step lands its own work, so there is nothing to hold a job for
  // — and the runner has no branch left that can produce the state.
  test("a finished step never parks the job — the next one is queued straight away", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("queued");
    // And it actually STARTS, unpressed: the old gate left `spawns` at 1
    // however many ticks followed.
    runner.tick();
    expect(spawns.length).toBe(2);
    expect(events.map((e) => e.event)).not.toContain("gate");
  });

  test("a finished job notifies once, with the branch to look at", () => {
    enqueue({ steps: ["analyze"] });
    const runner = makeRunner({
      readResult: () => ({ ...okResult(1), branchUrl: "https://example.test/compare" }),
    });
    runner.tick();
    runner.poll();
    expect(events.map((e) => e.event)).toEqual(["finished"]);
    expect(events[0]!.branchUrl).toBe("https://example.test/compare");
  });

  test("a stop notifies with its reason — the 02:00 case", () => {
    enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(3), ok: false, terminalReason: "timeout" }),
    });
    runner.tick();
    runner.poll();
    expect(events.map((e) => e.event)).toEqual(["stopped"]);
    expect(events[0]!.reason).toBe("timeout");
  });

  test("a failure notifies too", () => {
    enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0), ok: false, terminalReason: "refused", error: "the tree is dirty" }),
    });
    runner.tick();
    runner.poll();
    expect(events.map((e) => e.event)).toEqual(["failed"]);
    expect(events[0]!.reason).toContain("dirty");
  });
});
