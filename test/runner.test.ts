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
import { Runner, type SpawnResult, type Spawner } from "../src/runner.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: 1200,
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

const resolve = (project: string) =>
  project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null;

let dir: string;
let store: QueueStore;
let spawns: { jobId: string; step: string; resultFile: string }[];
let events: NotifyEvent[];
let now: number;

function makeRunner(opts: {
  spawn?: Spawner;
  alive?: (pid: number) => boolean;
  readResult?: (path: string) => unknown;
} = {}) {
  return new Runner({
    store,
    projectDir: (p) => join(dir, p),
    runnerBin: "/bin/true",
    resultDir: dir,
    now: () => new Date(now).toISOString(),
    today: () => "2026-08-16",
    spawn:
      opts.spawn ??
      ((job, step, resultFile): SpawnResult => {
        spawns.push({ jobId: job.id, step, resultFile });
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
    gateAfter: [],
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

describe("one job at a time", () => {
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
});

describe("steps and cost", () => {
  test("a successful step advances the job and adds its cost", () => {
    const job = enqueue({ steps: ["analyze", "implement"], gateAfter: [] });
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
    const job = enqueue({ steps: ["analyze", "implement"], gateAfter: [] });
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
    const job = enqueue({ steps: ["analyze", "implement", "archive"], gateAfter: [], jobCapUsd: 4 });
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

describe("gates and notifications (criterion 7)", () => {
  test("a step whose name is in gateAfter parks the job for approval", () => {
    const job = enqueue({ steps: ["analyze", "implement"], gateAfter: ["analyze"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.state).toBe("awaiting-approval");
    runner.tick();
    expect(spawns.length).toBe(1); // nothing starts until it is approved
  });

  test("the gate notifies exactly once, and approval starts exactly one more step", () => {
    const job = enqueue({ steps: ["analyze", "implement"], gateAfter: ["analyze"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    runner.poll(); // a second poll must not notify again
    runner.tick();
    expect(events.length).toBe(1);
    expect(events[0]!.event).toBe("gate");
    expect(events[0]!.step).toBe("analyze");
    expect(events[0]!.spec).toBe("81-queue-and-runner");
    expect(events[0]!.project).toBe("aide");
    expect(events[0]!.jobId).toBe(job.id);
    expect(events[0]!.costUsd).toBeCloseTo(1);

    // Approve, the way the route does it.
    store.update(job.id, { state: "queued" });
    runner.tick();
    expect(spawns.length).toBe(2);
    runner.tick();
    expect(spawns.length).toBe(2);
  });

  test("a finished job notifies once, with the branch to look at", () => {
    enqueue({ steps: ["analyze"], gateAfter: [] });
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
    enqueue({ steps: ["analyze", "implement"], gateAfter: [], jobCapUsd: 4 });
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
});
