// Split out of runner.test.ts by theme.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawns, store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

describe("with one slot, one job at a time", () => {
  test("a second job waits while the first is running", () => {
    const a = enqueue();
    // A different step: the queue refuses the same one twice while the
    // first is unfinished (its own rule, its own tests).
    const b = enqueue({ steps: ["implement"] });
    const runner = makeRunner();
    runner.tick();
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(a.id)?.state).toBe("running");
    expect(store.get(b.id)?.state).toBe("queued");
  });

  test("a finished step frees the slot", () => {
    const a = enqueue();
    enqueue({ steps: ["implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll(); // the first job's result lands
    expect(store.get(a.id)?.state).toBe("done");
    runner.tick();
    expect(spawns.length).toBe(2);
  });

  test("with maxConcurrent 1 the second job waits even for a different spec", () => {
    const a = enqueue();
    const b = enqueue({ specFolder: "91-parallel-spec-runs" });
    const runner = makeRunner({ maxConcurrent: 1 });
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(a.id)?.state).toBe("running");
    expect(store.get(b.id)?.state).toBe("queued");
  });
});

// Spec 91, slice 91b. The shared working tree was the only thing that
// made a single slot necessary; once every run has its own (slice 91a),
// the slot count is a number, and the number belongs in the config.
describe("several jobs at once", () => {
  test("two jobs for different specs both start in one tick", () => {
    const a = enqueue();
    const b = enqueue({ specFolder: "91-parallel-spec-runs" });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(2);
    expect(store.get(a.id)?.state).toBe("running");
    expect(store.get(b.id)?.state).toBe("running");
  });

  test("a third job waits for a slot", () => {
    const a = enqueue();
    const b = enqueue({ specFolder: "91-parallel-spec-runs" });
    const c = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["implement"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(2);
    expect(store.get(a.id)?.state).toBe("running");
    expect(store.get(b.id)?.state).toBe("running");
    expect(store.get(c.id)?.state).toBe("queued");
  });

  test("two jobs for the SAME spec are never both started", () => {
    // analyze and implement for one spec are ordered by nature. git
    // would refuse the second worktree on that branch anyway — but a
    // refusal mid-run is not a scheduling decision.
    const a = enqueue();
    const b = enqueue({ steps: ["implement"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(a.id)?.state).toBe("running");
    expect(store.get(b.id)?.state).toBe("queued");
  });

  test("two archive steps never run at once in the same project", () => {
    // Both branch from the code root's main and both land into it; the
    // second landing would find a main the first moved under it.
    const a = enqueue({ steps: ["archive"] });
    const b = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(a.id)?.state).toBe("running");
    const held = store.get(b.id)!;
    expect(held.state).toBe("queued");
    expect(held.error).toContain("another archive is running in this project");
  });

  // The sentence on a queued row is the reason RIGHT NOW. It used to be
  // written once, by whichever gate happened to hold the job, and left
  // there: a row went on saying "another archive is running in this
  // project" for minutes after that archive had landed, while the real
  // reason was a landing in flight (2026-09-04).
  test("the hold-back sentence goes when the reason does", () => {
    enqueue({ steps: ["archive"] });
    const b = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["implement"] });
    const runner = makeRunner({ maxConcurrent: 1 });
    runner.tick();
    // The one slot is taken, so this pass never reaches b: the old code
    // left whatever sentence b was carrying from an earlier pass, and
    // the reason it names is long gone.
    expect(store.get(b.id)?.state).toBe("queued");
    store.update(b.id, { error: "held back: another archive is running in this project", errorReason: "held-back" });
    runner.tick();
    expect(store.get(b.id)?.error).toBeUndefined();
    expect(store.get(b.id)?.errorReason).toBeUndefined();
  });

  // The whole queue stops while any job is landing, and every queued row
  // used to sit there with no reason at all — or with an older, wrong
  // one still on it.
  test("a landing in flight is said on every queued row", () => {
    const a = enqueue({ steps: ["analyze"] });
    const b = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    store.update(a.id, { state: "done", landing: true });
    runner.tick();
    expect(spawns.length).toBe(0);
    const held = store.get(b.id)!;
    expect(held.error).toContain("a landing is still running");
    expect(held.errorReason).toBe("held-back");
  });

  test("an archive waits only for another ARCHIVE — an analyze beside it starts", () => {
    const a = enqueue({ steps: ["analyze"] });
    const b = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(2);
    expect(store.get(a.id)?.state).toBe("running");
    expect(store.get(b.id)?.state).toBe("running");
  });

  test("poll completes EVERY running job, not just the first", () => {
    const a = enqueue();
    const b = enqueue({ specFolder: "91-parallel-spec-runs" });
    const runner = makeRunner({ maxConcurrent: 2, readResult: () => okResult(1) });
    runner.tick();
    expect(spawns.length).toBe(2);
    runner.poll();
    expect(store.get(a.id)?.state).toBe("done");
    expect(store.get(b.id)?.state).toBe("done");
  });

  test("the daily cap counts the budget of work already in flight", () => {
    // $20 cap, $15 spent, two $3 jobs. Both would pass a check that only
    // looks at what is already RECORDED — addSpentToday runs at
    // completion, so a running job's budget is counted nowhere.
    const a = enqueue();
    const b = enqueue({ specFolder: "91-parallel-spec-runs" });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.addSpentToday(15);
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(a.id)?.state).toBe("running");
    const held = store.get(b.id)!;
    expect(held.state).toBe("queued");
    expect(held.error).toContain("daily cap");
  });

  test("a job held by the daily cap does not block a cheaper one behind it", () => {
    const dear = enqueue();
    const cheap = enqueue({ specFolder: "91-parallel-spec-runs", budgetUsd: 1 });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.addSpentToday(18); // 18 + 3 > 20, but 18 + 1 is not
    runner.tick();
    expect(store.get(dear.id)?.state).toBe("queued");
    expect(store.get(dear.id)?.error).toContain("daily cap");
    expect(store.get(cheap.id)?.state).toBe("running");
  });
});

// Spec 353: a quick step (create/archive) jumps a queued slow step
// (analyze/implement), whatever the age of either.
describe("quick steps before slow ones", () => {
  test("a younger queued archive starts before an older queued analyze", () => {
    const analyze = enqueue({ steps: ["analyze"] });
    const archive = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
    const runner = makeRunner({ maxConcurrent: 1 });
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(spawns[0]?.step).toBe("archive");
    expect(store.get(archive.id)?.state).toBe("running");
    expect(store.get(analyze.id)?.state).toBe("queued");
  });

  test("oldest first within the same group", () => {
    const first = enqueue({ steps: ["archive"] });
    enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
    const runner = makeRunner({ maxConcurrent: 1 });
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(first.id)?.state).toBe("running");
  });

  test("a held-back quick job does not block an older unblocked slow job behind it", () => {
    const archive = enqueue({ steps: ["archive"] });
    const analyze = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["analyze"] });
    const runner = makeRunner({ maxConcurrent: 1 });
    const blocked = new Map([[archive.id, "80-some-dependency"]]);
    runner.tick(blocked);
    expect(spawns.length).toBe(1);
    expect(spawns[0]?.step).toBe("analyze");
    expect(store.get(analyze.id)?.state).toBe("running");
    const held = store.get(archive.id)!;
    expect(held.state).toBe("queued");
    expect(held.error).toContain("held back");
  });
});

describe("steps and cost", () => {
  test("a successful step advances the job and adds its cost", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1.5) });
    runner.tick();
    runner.poll();
    const after = store.get(job.id)!;
    expect(after.stepIndex).toBe(1);
    expect(after.spentUsd).toBeCloseTo(1.5);
    expect(after.state).toBe("queued");
    expect(after.results.length).toBe(1);
  });

  test("a step stopped by its budget ends the job as stopped, not failed", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({
      readResult: () => ({ ...okResult(3), ok: false, terminalReason: "budget" }),
    });
    runner.tick();
    runner.poll();
    const after = store.get(job.id)!;
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("budget");
    expect(after.stepIndex).toBe(0);
    runner.tick();
    expect(spawns.length).toBe(1); // no further step
  });

  test("a timeout is a stop too, with the reason kept", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(3), ok: false, terminalReason: "timeout", costMeasured: false }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("stopped");
    expect(store.get(job.id)?.stopReason).toBe("timeout");
  });

  test("a provider limit stops on the current step and starts no later step", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({
      readResult: () => ({
        ...okResult(0), ok: false, terminalReason: "provider-limit",
        error: "seven day provider limit; resets 2026-08-24 12:00 UTC",
      }),
    });
    runner.tick();
    runner.poll();
    const after = store.get(job.id)!;
    expect(after.state).toBe("stopped");
    expect(after.stopReason as string).toBe("provider-limit");
    expect(after.stepIndex).toBe(0);
    expect(after.error).toContain("resets 2026-08-24");
    runner.tick();
    expect(spawns).toHaveLength(1);
  });

  test("a refused or broken step fails the job", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0), ok: false, terminalReason: "refused", error: "the tree is dirty" }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("failed");
    expect(store.get(job.id)?.error).toContain("dirty");
  });

  // Spec 153. A step refused at START for a conflict — the runner
  // cannot bring the spec's branch up to date with the base. The row
  // reads that off `job.errorReason` alone (spec 149), so the reason
  // has to survive the trip from the result file to the stored job;
  // without it the row read "press Run to try again", which fails
  // identically. Since spec 171 the row shows it rather than acting on
  // it: `archive` is handed the conflict open and resolves it itself,
  // so one that reaches a reader is one no machine could settle.
  test("a refusal that names a conflict stores the reason on the job", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({
        ...okResult(0),
        ok: false,
        terminalReason: "refused",
        error: "cannot bring aide/153-x up to date with origin/main in /repos/aide (conflict — merge it by hand)",
        errorReason: "conflict",
      }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("failed");
    expect(store.get(job.id)?.errorReason).toBe("conflict");
  });

  test("a refusal with no reason leaves the field unset", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0), ok: false, terminalReason: "refused", error: "missing --spec" }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.errorReason).toBeUndefined();
  });
});

// The result file is written by another process and read back as
// whatever JSON happens to be in it. Every field is therefore a
// question, not a promise, and the defaults are the answer.
describe("a result file that left fields out", () => {
  test("a cost with no measured flag counts as measured, not as an estimate", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => ({ ok: true, costUsd: 2, terminalReason: "completed" }) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.results[0]?.costMeasured).toBe(true);
  });

  test("a result with no ok flag fails the job rather than passing it", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => ({ costUsd: 1 }) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("failed");
  });

  test("a result with no reason still records one", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => ({ ok: true, costUsd: 1 }) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.results[0]?.terminalReason).toBeTruthy();
  });

  // Spec 118. A cost has a default (the over-charge rule gives a killed
  // run one); a token count has none, and inventing a zero would read as
  // "this step used nothing" on every job recorded before the field
  // existed.
  test("a result with no tokens leaves the step and the job without a count", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => ({ ok: true, costUsd: 1, terminalReason: "completed" }) });
    runner.tick();
    runner.poll();
    const after = store.get(job.id)!;
    expect(after.results[0]?.tokens).toBeUndefined();
    expect(after.spentTokens).toBeUndefined();
  });

  test("a tokens field of the wrong shape is dropped, not carried", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ok: true, costUsd: 1, terminalReason: "completed", tokens: "lots" }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.results[0]?.tokens).toBeUndefined();
  });
});
