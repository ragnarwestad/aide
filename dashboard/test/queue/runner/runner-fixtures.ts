// Shared test harness for the runner.test.ts split, across
// runner-scheduling.test.ts, runner-caps-and-notifications.test.ts,
// runner-session-and-page.test.ts and runner-completion-and-dependency.test.ts
// (split out of runner.test.ts by theme).
//
// Criteria 6 and 8 (spec 81, slice 81b): the scheduler. One job at a
// time; a cap is checked BEFORE a step starts, because a cap that only
// stops you afterwards is a report, not a cap; and a job left `running`
// by a restart is reconciled from the pid and the result file rather
// than guessed at.
//
// The spawner and the clock are injected, so no test here starts a
// process or spends a cent.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import type { NotifyEvent } from "../../../src/integrations/notify.ts";
import { Runner, type RunnerOptions, type SpawnResult, type Spawner } from "../../../src/queue/runner.ts";

export const DEFAULTS: QueueDefaults = {
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
//
// A second project name, resolving to the same two folders (spec 402):
// the repo-scoped hold-back tests need two DIFFERENT project strings to
// enqueue jobs under, whatever repo `makeRunner()`'s own overrides then
// point each one at.
const resolve = (project: string) =>
  project === "aide" || project === "other-project"
    ? { specFolders: ["81-queue-and-runner", "91-parallel-spec-runs"] }
    : null;

export let dir: string;
export let store: QueueStore;
export let spawns: { jobId: string; step: string; resultFile: string; sessionId: string; streamFile: string }[];
export let events: NotifyEvent[];
export let now: number;

/** Move the injected clock (spec 384) — an imported `let` binding cannot
 *  be assigned from outside this module, so a test that advances time
 *  between two `tick()`/`poll()` calls goes through this instead. */
export function setNow(ms: number): void {
  now = ms;
}

export function makeRunner(opts: {
  spawn?: Spawner;
  alive?: (pid: number) => boolean;
  readResult?: (path: string) => unknown;
  newSessionId?: () => string;
  maxConcurrent?: number;
  onStepDone?: RunnerOptions["onStepDone"];
  /** Overrides the default `(p) => join(dir, p)` — needed for a test
   *  that maps two different project strings onto the SAME path (spec
   *  402's REQ-6), which the default, injective mapping cannot produce. */
  projectDir?: (project: string) => string;
  specsRoot?: RunnerOptions["specsRoot"];
} = {}) {
  return new Runner({
    store,
    onStepDone: opts.onStepDone,
    // 1 unless a test says otherwise, so every case written before spec
    // 91 still describes the behaviour it was written for.
    maxConcurrent: opts.maxConcurrent,
    projectDir: opts.projectDir ?? ((p) => join(dir, p)),
    specsRoot: opts.specsRoot,
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

export function enqueue(overrides: Record<string, unknown> = {}) {
  const r = store.enqueue({
    project: "aide",
    specFolder: "81-queue-and-runner",
    steps: ["analyze"],
    ...overrides,
  });
  if (!r.ok) throw new Error(r.error);
  return r.job;
}

export const okResult = (cost: number) => ({
  ok: true,
  exitCode: 0,
  sessionId: "s1",
  costUsd: cost,
  costMeasured: true,
  terminalReason: "completed",
  repos: [],
});

export function resetHarness(): void {
  dir = mkdtempSync(join(tmpdir(), "aide-runner-"));
  store = new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve });
  spawns = [];
  events = [];
  now = Date.parse("2026-08-16T10:00:00Z");
}

export function cleanupHarness(): void {
  rmSync(dir, { recursive: true, force: true });
}
