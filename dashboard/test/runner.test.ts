// Criteria 6 and 8 (spec 81, slice 81b): the scheduler. One job at a
// time; a cap is checked BEFORE a step starts, because a cap that only
// stops you afterwards is a report, not a cap; and a job left `running`
// by a restart is reconciled from the pid and the result file rather
// than guessed at.
//
// The spawner and the clock are injected, so no test here starts a
// process or spends a cent.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../src/queue.ts";
import type { NotifyEvent } from "../src/notify.ts";
import { Runner, type RunnerOptions, type SpawnResult, type Spawner } from "../src/runner.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: { default: 1200 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// Two spec folders, not one: since spec 91 the scheduler may run several
// jobs at once, and a store that cannot resolve a second spec refuses the
// enqueue long before tick() is reached.
const resolve = (project: string) =>
  project === "aide" ? { specFolders: ["81-queue-and-runner", "91-parallel-spec-runs"] } : null;

let dir: string;
let store: QueueStore;
let spawns: { jobId: string; step: string; resultFile: string; sessionId: string; streamFile: string }[];
let events: NotifyEvent[];
let now: number;

function makeRunner(opts: {
  spawn?: Spawner;
  alive?: (pid: number) => boolean;
  readResult?: (path: string) => unknown;
  newSessionId?: () => string;
  maxConcurrent?: number;
  onStepDone?: RunnerOptions["onStepDone"];
} = {}) {
  return new Runner({
    store,
    onStepDone: opts.onStepDone,
    // 1 unless a test says otherwise, so every case written before spec
    // 91 still describes the behaviour it was written for.
    maxConcurrent: opts.maxConcurrent,
    projectDir: (p) => join(dir, p),
    runnerBin: "/bin/true",
    resultDir: dir,
    now: () => new Date(now).toISOString(),
    today: () => "2026-08-16",
    newSessionId: opts.newSessionId ?? (() => `sess-${spawns.length + 1}`),
    spawn:
      opts.spawn ??
      ((job, step, resultFile, sessionId, streamFile): SpawnResult => {
        spawns.push({ jobId: job.id, step, resultFile, sessionId, streamFile });
        return { pid: 1000 + spawns.length, pgid: 1000 + spawns.length };
      }),
    isAlive: opts.alive ?? (() => true),
    readResult: opts.readResult ?? (() => null),
    notify: (event) => void events.push(event),
  });
}

function enqueue(overrides: Record<string, unknown> = {}) {
  const r = store.enqueue({
    project: "aide",
    specFolder: "81-queue-and-runner",
    steps: ["analyze"],
    ...overrides,
  });
  if (!r.ok) throw new Error(r.error);
  return r.job;
}

const okResult = (cost: number) => ({
  ok: true,
  exitCode: 0,
  sessionId: "s1",
  costUsd: cost,
  costMeasured: true,
  terminalReason: "completed",
  repos: [],
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-runner-"));
  store = new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve });
  spawns = [];
  events = [];
  now = Date.parse("2026-08-16T10:00:00Z");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
  // cannot bring the spec's branch up to date with the base — is the
  // one failure a `resolve` step could finish. The row offers Resolve
  // off `job.errorReason` alone (spec 149), so the reason has to
  // survive the trip from the result file to the stored job; without
  // it the row read "press Run to try again", which fails identically.
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
    expect(runner.spentToday()).toBeCloseTo(1);
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

describe("caps are checked before a step starts", () => {
  test("the daily cap holds a job back, and says so", () => {
    const job = enqueue();
    const runner = makeRunner();
    runner.addSpentToday(18); // 18 + 3 > 20
    runner.tick();
    expect(spawns.length).toBe(0);
    const after = store.get(job.id)!;
    expect(after.state).toBe("queued");
    expect(after.error).toContain("daily cap");
  });

  test("the per-job cap parks the job instead of starting another step", () => {
    const job = enqueue({ steps: ["analyze", "implement", "archive"], jobCapUsd: 4 });
    const runner = makeRunner({ readResult: () => okResult(3) });
    runner.tick();
    runner.poll(); // spent 3 of 4; the next step would need 3 more
    runner.tick();
    expect(spawns.length).toBe(1);
    const after = store.get(job.id)!;
    expect(after.state).toBe("stopped");
    expect(after.error).toContain("job cap");
  });

  test("a day boundary clears the daily total", () => {
    const runner = makeRunner();
    runner.addSpentToday(18);
    expect(runner.spentToday()).toBeCloseTo(18);
    runner.setToday("2026-08-17");
    expect(runner.spentToday()).toBe(0);
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
      readResult: () => ({ ...okResult(3), ok: false, terminalReason: "budget" }),
    });
    runner.tick();
    runner.poll();
    expect(events.map((e) => e.event)).toEqual(["stopped"]);
    expect(events[0]!.reason).toBe("budget");
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

  test("a job stopped by its own cap notifies as well — nothing ends in silence", () => {
    enqueue({ steps: ["analyze", "implement"], jobCapUsd: 4 });
    const runner = makeRunner({ readResult: () => okResult(3) });
    runner.tick();
    runner.poll();
    runner.tick(); // the next step would breach the job cap
    expect(events.map((e) => e.event)).toEqual(["stopped"]);
    expect(events[0]!.reason).toContain("job cap");
  });

  test("a job held back by the daily cap is not an ending, and does not notify", () => {
    enqueue();
    const runner = makeRunner();
    runner.addSpentToday(18);
    runner.tick();
    expect(events).toEqual([]);
  });
});

// Criteria 3 and 10 (spec 02): the queue used to learn the session id
// from the result file — by which time the step was over and there was
// nothing left to watch. Generating it BEFORE the spawn is what turns
// "$0 and nothing" into a session the live panel can follow.
describe("the session id is known before the step starts", () => {
  test("tick() hands the spawner a session id and a stream file, and stores both on the job", () => {
    const job = enqueue();
    const runner = makeRunner({ newSessionId: () => "11111111-2222-4333-8444-555555555555" });
    runner.tick();

    expect(spawns[0]!.sessionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(spawns[0]!.streamFile).toContain(job.id);
    const stored = store.get(job.id)!;
    expect(stored.state).toBe("running");
    expect(stored.sessionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(stored.streamFile).toBe(spawns[0]!.streamFile);
  });

  test("the id is stored before any result could have arrived", () => {
    // readResult never answers, so nothing has completed: whatever the
    // job carries now was known in advance, not learned afterwards.
    const job = enqueue();
    makeRunner({ readResult: () => null }).tick();
    expect(store.get(job.id)!.results).toEqual([]);
    expect(store.get(job.id)!.sessionId).toBeTruthy();
  });

  test("every step gets its own session id", () => {
    enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    runner.tick();
    expect(spawns).toHaveLength(2);
    expect(spawns[0]!.sessionId).not.toBe(spawns[1]!.sessionId);
  });

  test("complete() clears the live id and records it on the finished step", () => {
    const job = enqueue();
    const runner = makeRunner({
      newSessionId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      readResult: () => okResult(1),
    });
    runner.tick();
    const streamFile = store.get(job.id)!.streamFile;
    runner.poll();

    const done = store.get(job.id)!;
    expect(done.state).toBe("done");
    // A finished job that still advertises a live session is a lie the
    // page would render as "running somewhere".
    expect(done.sessionId).toBeUndefined();
    expect(done.results[0]!.sessionId).toBe("s1");
    expect(done.results[0]!.streamFile).toBe(streamFile);
  });

  test("a result that reports no session falls back to the id we supplied", () => {
    const job = enqueue();
    const { sessionId: _drop, ...noSession } = okResult(1);
    const runner = makeRunner({
      newSessionId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      readResult: () => noSession,
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)!.results[0]!.sessionId).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  test("an interrupted step clears the live id too", () => {
    const job = enqueue();
    const runner = makeRunner({ alive: () => false, readResult: () => null });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)!.state).toBe("interrupted");
    expect(store.get(job.id)!.sessionId).toBeUndefined();
  });
});

describe("what the page needs from a step", () => {
  test("the branch link from the result is kept on the job", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(1), branchUrl: "https://example.test/compare" }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.branchUrl).toBe("https://example.test/compare");
  });

  // Spec 89: `aide-run-spec` reports one entry per repo it pushed, and
  // the runner read only the singular neighbour. A job that touches two
  // repos makes two branches, and one link for both was the whole bug.
  test("every repo the step pushed to is kept, not just the representative one", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({
        ...okResult(1),
        branchUrl: "https://example.test/aide/compare",
        branchUrls: [
          { root: "/repos/aide", url: "https://example.test/aide/compare" },
          { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
        ],
      }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.branchUrls).toEqual([
      { root: "/repos/aide", url: "https://example.test/aide/compare" },
      { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
    ]);
  });

  // An analyze step changes only the specs repo; the implement step
  // after it changes both. Replacing the list wholesale would make the
  // project's branch vanish from a spec that has one.
  test("a later step touching fewer repos does not erase the earlier ones", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    let call = 0;
    const runner = makeRunner({
      readResult: () => {
        call += 1;
        return call === 1
          ? {
              ...okResult(1),
              branchUrls: [
                { root: "/repos/aide", url: "https://example.test/aide/old" },
                { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
              ],
            }
          : {
              ...okResult(1),
              branchUrls: [{ root: "/repos/aide", url: "https://example.test/aide/new" }],
            };
      },
    });
    runner.tick();
    runner.poll(); // analyze lands
    runner.tick();
    runner.poll(); // implement lands
    expect(store.get(job.id)?.branchUrls).toEqual([
      // The root both steps touched carries the LATEST url…
      { root: "/repos/aide", url: "https://example.test/aide/new" },
      // …and the one only the first step touched is still there.
      { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
    ]);
  });

  test("a step that pushed nowhere leaves what earlier steps recorded", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    let call = 0;
    const runner = makeRunner({
      readResult: () => {
        call += 1;
        return call === 1
          ? { ...okResult(1), branchUrls: [{ root: "/repos/aide", url: "https://example.test/aide" }] }
          : okResult(1);
      },
    });
    runner.tick();
    runner.poll();
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.branchUrls).toEqual([
      { root: "/repos/aide", url: "https://example.test/aide" },
    ]);
  });
});

// --- spec 93: a step that is not finished when the step is over --------------

// Landing a newly created spec on the default branch happens AFTER the
// step reports success: in the dashboard, with awaited git calls, against
// the SHARED main checkout that worktree isolation does not cover. So a
// job's state stops being the whole story — `complete()` moves a
// single-step job to `done` synchronously, and the slot it frees is a
// slot another job would take while the merge is still switching
// branches under it.
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

// --- spec 106: a resolve job is a job like any other -------------------------
//
// The Resolve control queues an ordinary job, so the two
// guards that already exist have to hold for it: the scheduler never
// starts two jobs for one spec, and the store refuses a second
// unfinished job covering the same step. No third guard was built for
// this step, so these are the tests that say so.

describe("a resolve job in flight (spec 106)", () => {
  test("it blocks a same-spec Run exactly like any other in-flight job", () => {
    const resolving = enqueue({ steps: ["resolve"] });
    const later = enqueue({ steps: ["implement"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(1);
    expect(store.get(resolving.id)?.state).toBe("running");
    expect(store.get(later.id)?.state).toBe("queued");
  });

  test("a second resolve for the same spec is refused before it is stored", () => {
    enqueue({ steps: ["resolve"] });
    const again = store.enqueue({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["resolve"],
      });
    expect(again.ok).toBe(false);
  });

  test("another spec's resolve is not blocked by this one", () => {
    const mine = enqueue({ steps: ["resolve"] });
    const theirs = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["resolve"] });
    const runner = makeRunner({ maxConcurrent: 2 });
    runner.tick();
    expect(spawns.length).toBe(2);
    expect(store.get(mine.id)?.state).toBe("running");
    expect(store.get(theirs.id)?.state).toBe("running");
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
