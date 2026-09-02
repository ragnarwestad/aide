// Split out of runner.test.ts by theme.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { QueueStore } from "../../src/queue/queue.ts";
import { DEFAULTS, dir, spawns, store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";

const resolve = (project: string) =>
  project === "aide" ? { specFolders: ["81-queue-and-runner", "91-parallel-spec-runs"] } : null;

beforeEach(resetHarness);
afterEach(cleanupHarness);

describe("spec 93: the completion hook and the landing window", () => {
  const outcome = (extra: Record<string, unknown> = {}) => ({ ...okResult(0.1), ...extra });

  test("onStepDone fires exactly once per finished step, with the outcome", () => {
    const seen: { step?: string; ok: boolean; branch?: string; specFolder?: string }[] = [];
    const job = enqueue({ steps: ["create"] });
    const runner = makeRunner({
      readResult: () => outcome({ branch: "aide/new-abc123de", specFolder: "94-a-new-spec" }),
      onStepDone: (_job, step, o) => {
        seen.push({ step, ok: !!o.ok, branch: o.branch, specFolder: o.specFolder });
      },
    });
    runner.tick();
    runner.poll();
    runner.poll(); // the job is finished: nothing is polled twice
    expect(store.get(job.id)?.state).toBe("done");
    expect(seen).toEqual([
      { step: "create", ok: true, branch: "aide/new-abc123de", specFolder: "94-a-new-spec" },
    ]);
  });

  test("a hook whose work outlives the call holds back EVERY other job, not just another create", async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const landing = enqueue({ steps: ["create"] });
    const runner = makeRunner({ readResult: () => outcome(), onStepDone: () => work, maxConcurrent: 2 });
    runner.tick();
    runner.poll();
    // The create job is `done` — its slot is free, and without the
    // landing flag the queue would fill it while the merge is still
    // writing to the shared main checkout.
    expect(store.get(landing.id)?.state).toBe("done");
    expect(store.get(landing.id)?.landing).toBe(true);

    const before = spawns.length;
    // An UNRELATED job for a different spec: the case the create-only
    // version of this rule left open.
    enqueue({ specFolder: "91-parallel-spec-runs", steps: ["analyze"] });
    runner.tick();
    expect(spawns.length).toBe(before);

    // ...and once the landing is over, the queue moves again on its own.
    finish();
    await work;
    await Promise.resolve();
    expect(store.get(landing.id)?.landing).toBeUndefined();
    runner.tick();
    expect(spawns.length).toBe(before + 1);
  });

  test("a hook that finishes without ever awaiting still leaves the queue open", async () => {
    // The ordering hazard the runner owns both sides of the flag for: an
    // async function whose body happens not to await anything settles
    // before `complete()` has even set `landing`. A hook that cleared the
    // flag itself would clear one that did not exist yet, and the flag
    // `complete()` then set would hold the whole queue shut with nothing
    // left to clear it.
    const landing = enqueue({ steps: ["create"] });
    const runner = makeRunner({
      readResult: () => outcome(),
      // eslint-disable-next-line @typescript-eslint/require-await
      onStepDone: async () => undefined,
      maxConcurrent: 2,
    });
    runner.tick();
    runner.poll();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get(landing.id)?.landing).toBeUndefined();

    const before = spawns.length;
    enqueue({ specFolder: "91-parallel-spec-runs", steps: ["analyze"] });
    runner.tick();
    expect(spawns.length).toBe(before + 1);
  });

  test("a step that failed is reported to the hook too, and lands nothing", () => {
    const seen: boolean[] = [];
    const job = enqueue({ steps: ["create"] });
    const runner = makeRunner({
      readResult: () => outcome({ ok: false, terminalReason: "cli-error", error: "no" }),
      onStepDone: (_j, _s, o) => {
        seen.push(!!o.ok);
      },
    });
    runner.tick();
    runner.poll();
    expect(seen).toEqual([false]);
    expect(store.get(job.id)?.state).toBe("failed");
    expect(store.get(job.id)?.landing).toBeFalsy();
  });

  test("a landing flag left behind by a restart never wedges the queue", () => {
    // The flag belongs to a call in flight in THIS process; a mirror read
    // back after a crash has no such call behind it, and a flag that
    // survived would hold the whole queue shut with nothing to clear it.
    const job = enqueue({ steps: ["create"] });
    store.update(job.id, { landing: true, state: "done" });
    const reloaded = new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve });
    expect(reloaded.get(job.id)?.landing).toBeUndefined();
  });
});

// --- spec 122: a dependency parks a job, it does not fail it -----------------
//
// A queued implement whose dependency was still unmerged used to start,
// be refused by `aide-run-spec`, and land in `failed` — a state nothing
// retries, so somebody had to notice and press Run again (97 was pressed
// three times, 102 twice, against dependencies that merged minutes
// later). The job now waits instead, in exactly the shape the daily cap
// already waits in: `error` set, `state` untouched, no slot taken.
//
// `Runner` stays policy-free and synchronous. WHICH jobs are held back
// is decided by the caller (`serve.ts`, which owns the git answer) and
// arrives as a plain map — the Runner trusts it verbatim and knows
// nothing about steps or branches.

describe("parked on a dependency (spec 122)", () => {
  test("a job named in the blocked map is not spawned and stays queued with a reason", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick(new Map([[job.id, "80-dependency"]]));
    expect(spawns.length).toBe(0);
    const stored = store.get(job.id);
    expect(stored?.state).toBe("queued");
    expect(stored?.error).toContain("80-dependency");
  });

  test("the same job starts once the map no longer names it", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick(new Map([[job.id, "80-dependency"]]));
    expect(spawns.length).toBe(0);
    runner.tick(new Map());
    expect(spawns.length).toBe(1);
    const stored = store.get(job.id);
    expect(stored?.state).toBe("running");
    // Cleared by the start itself, the way every other held-back reason
    // is — a stale line under a running row is a lie.
    expect(stored?.error).toBeUndefined();
  });

  test("a parked job takes no slot: a job behind it still starts", () => {
    const parked = enqueue({ steps: ["implement"] });
    const other = enqueue({ specFolder: "91-parallel-spec-runs" });
    const runner = makeRunner({ maxConcurrent: 1 });
    runner.tick(new Map([[parked.id, "80-dependency"]]));
    expect(spawns.length).toBe(1);
    expect(spawns[0].jobId).toBe(other.id);
    expect(store.get(parked.id)?.state).toBe("queued");
  });

  test("no map at all is exactly today's behaviour", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(job.id)?.state).toBe("running");
  });

  test("an entry for a job that is not queued changes nothing", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick();
    expect(store.get(job.id)?.state).toBe("running");
    runner.tick(new Map([[job.id, "80-dependency"]]));
    expect(store.get(job.id)?.state).toBe("running");
    expect(store.get(job.id)?.error).toBeUndefined();
  });
});

// --- spec 344: implement refuses to start before analyze has run -----------
//
// The same shape as the dependency park above, one question earlier: a
// job id SET rather than a Map, since the message carries no per-job
// detail (unlike a dependency's folder name, every job it applies to
// gets the same fixed sentence).

describe("parked on its own missing analyze step (spec 344)", () => {
  test("a job named in the notAnalyzed set is not spawned and stays queued with a reason", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick(undefined, new Set([job.id]));
    expect(spawns.length).toBe(0);
    const stored = store.get(job.id);
    expect(stored?.state).toBe("queued");
    expect(stored?.error).toBe("held back: not analyzed yet — run /aide-analyze first");
  });

  test("the same job starts once the set no longer names it", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick(undefined, new Set([job.id]));
    expect(spawns.length).toBe(0);
    runner.tick(undefined, new Set());
    expect(spawns.length).toBe(1);
    const stored = store.get(job.id);
    expect(stored?.state).toBe("running");
    expect(stored?.error).toBeUndefined();
  });

  test("checked before the dependency map: a job in both is held back for the analyze reason", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick(new Map([[job.id, "80-dependency"]]), new Set([job.id]));
    expect(spawns.length).toBe(0);
    expect(store.get(job.id)?.error).toBe("held back: not analyzed yet — run /aide-analyze first");
  });

  test("no set at all is exactly today's behaviour", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(job.id)?.state).toBe("running");
  });
});

// --- spec 160: a step added while the job runs ---------------------------------

// Nothing in the runner had to change for this: `startOne` reads
// `job.steps[job.stepIndex]` at the moment it starts a step, and
// `tick()` calls it again every two seconds. These tests pin that,
// so a future rewrite that caches the step list is a failed test
// rather than a feature that quietly stops working.
describe("a step appended to a running job's tail (spec 160)", () => {
  test("is started once the step now running has finished", () => {
    const job = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    expect(store.get(job.id)!.state).toBe("running");
    // Ticked while analyze is in flight.
    expect(store.editTailStep(job.id, "implement", true).ok).toBe(true);
    runner.poll();
    expect(store.get(job.id)!.stepIndex).toBe(1);
    runner.tick();
    expect(spawns.map((s) => s.step)).toEqual(["analyze", "implement"]);
  });

  test("that is removed again before it starts is never spawned", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    expect(store.editTailStep(job.id, "implement", false).ok).toBe(true);
    runner.poll();
    runner.tick();
    expect(spawns.map((s) => s.step)).toEqual(["analyze"]);
    expect(store.get(job.id)!.state).toBe("done");
  });

  // The gate is a per-tick question, not a per-job one: a step added to
  // a running job's tail meets it when it becomes current, exactly as a
  // step named at job creation does. Nothing refuses it at add time.
  test("a dependency-gated one is accepted at once and held back only when it becomes current", () => {
    const job = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    expect(store.editTailStep(job.id, "archive", true).ok).toBe(true);
    runner.poll();
    // Now archive is the current step, and its dependency has not landed.
    runner.tick(new Map([[job.id, "80-dependency"]]));
    expect(spawns.map((s) => s.step)).toEqual(["analyze"]);
    const after = store.get(job.id)!;
    expect(after.state).toBe("queued");
    expect(after.error).toContain("held back: depends on 80-dependency");
  });
});
