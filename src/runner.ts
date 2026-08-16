// The scheduler (spec 81, slice 81b): one job at a time, every step
// bounded before it starts, and a restart reconciled rather than
// guessed at.
//
// Two shapes here are deliberate:
//
//   * `aide-run-spec` is spawned DETACHED, in its own process group.
//     Measured on the mini (2026-08-16): `launchctl bootout` does not
//     reap such a child — it survives and reparents to pid 1. So a
//     redeploy does not kill a run, and "the pid is still alive" is the
//     COMMON case after a restart, not a rare one.
//   * a detached child has no pipe home, so **the result file is the
//     contract**. The scheduler polls the pid and the file; it never
//     waits on a stream it does not have.
//
// The spawner, the clock and the liveness check are injected, so the
// tests start no processes.

import type { NotifyEvent } from "./notify.ts";
import type { Job, QueueStore, WorkflowStep } from "./queue.ts";

export interface SpawnResult {
  pid: number;
  pgid: number;
}

export type Spawner = (job: Job, step: WorkflowStep, resultFile: string) => SpawnResult;

export interface StepOutcome {
  ok: boolean;
  costUsd: number;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  /** The compare or PR page for the branch this step wrote to, when the
   *  push mode produced one. */
  branchUrl?: string;
  error?: string;
}

export interface RunnerOptions {
  store: QueueStore;
  /** Where a project's checkout lives on this machine. */
  projectDir: (project: string) => string;
  runnerBin: string;
  resultDir: string;
  spawn: Spawner;
  isAlive: (pid: number) => boolean;
  readResult: (path: string) => unknown;
  /** Remove a previous step's result before starting the next one —
   *  otherwise poll() would read the old file and "complete" the new
   *  step the instant it starts. */
  clearResult?: (path: string) => void;
  now: () => string;
  today: () => string;
  /** Every ENDING is announced: a gate, a finish, a stop, a failure. A
   *  job that parked at 02:00 must not wait for someone to open the
   *  page. Injected, so the tests spawn nothing. */
  notify?: (event: NotifyEvent) => void;
}

export class Runner {
  private readonly o: RunnerOptions;
  private day: string;
  private spent = 0;

  constructor(opts: RunnerOptions) {
    this.o = opts;
    this.day = opts.today();
  }

  // --- the day's total ------------------------------------------------------

  spentToday(): number {
    this.rollDay();
    return this.spent;
  }

  addSpentToday(usd: number): void {
    this.rollDay();
    this.spent += usd;
  }

  /** Test seam for the midnight boundary. */
  setToday(day: string): void {
    this.day = day;
    this.spent = 0;
  }

  private rollDay(): void {
    const today = this.o.today();
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }

  // --- starting work --------------------------------------------------------

  private running(): Job | undefined {
    return this.o.store.list().find((j) => j.state === "running");
  }

  /** Start the next step, if the slot is free and every cap allows it. */
  tick(): void {
    if (this.running()) return; // one job at a time
    const job = [...this.o.store.list()].reverse().find((j) => j.state === "queued");
    if (!job) return;
    const step = job.steps[job.stepIndex];
    if (!step) {
      this.o.store.update(job.id, { state: "done", finishedAt: this.o.now() });
      return;
    }

    // Both caps are checked BEFORE the step starts: a cap that only
    // stops you afterwards is a report, not a cap.
    if (job.spentUsd + job.budgetUsd > job.jobCapUsd) {
      const reason = `the job cap ($${job.jobCapUsd}) would be exceeded by the next step`;
      const stopped = this.o.store.update(job.id, {
        state: "stopped",
        finishedAt: this.o.now(),
        error: reason,
      });
      this.announce(stopped ?? job, "stopped", step, reason);
      return;
    }
    if (this.spentToday() + job.budgetUsd > this.o.store.defaults.dailyCapUsd) {
      this.o.store.update(job.id, {
        error: `held back: the daily cap ($${this.o.store.defaults.dailyCapUsd}) would be exceeded`,
      });
      return;
    }

    const resultFile = `${this.o.resultDir}/${job.id}.json`;
    this.o.clearResult?.(resultFile);
    const { pid, pgid } = this.o.spawn(job, step, resultFile);
    this.o.store.update(job.id, {
      state: "running",
      pid,
      pgid,
      resultFile,
      startedAt: job.startedAt ?? this.o.now(),
      error: undefined,
    });
  }

  // --- finishing work -------------------------------------------------------

  /** Look at the running job: has its result landed? */
  poll(): void {
    const job = this.running();
    if (!job || !job.resultFile) return;
    const raw = this.o.readResult(job.resultFile);
    if (raw) {
      this.complete(job, raw as StepOutcome);
      return;
    }
    // No result yet. If the process is also gone, the run died without
    // leaving one — see reconcile().
    if (job.pid !== undefined && !this.o.isAlive(job.pid)) {
      this.o.store.update(job.id, {
        state: "interrupted",
        finishedAt: this.o.now(),
        error: "the run vanished without leaving a result",
      });
    }
  }

  /** On boot: a job left `running` is resolved, never assumed. */
  reconcile(): void {
    for (const job of this.o.store.list()) {
      if (job.state !== "running") continue;
      if (job.pid !== undefined && this.o.isAlive(job.pid)) continue; // still going — keep watching
      const raw = job.resultFile ? this.o.readResult(job.resultFile) : null;
      if (raw) {
        this.complete(job, raw as StepOutcome);
      } else {
        this.o.store.update(job.id, {
          state: "interrupted",
          finishedAt: this.o.now(),
          error: "the server restarted while this step was running, and it left no result",
        });
      }
    }
  }

  private announce(job: Job, event: NotifyEvent["event"], step: WorkflowStep | undefined, reason?: string): void {
    this.o.notify?.({
      event,
      project: job.project,
      spec: job.specFolder,
      step,
      jobId: job.id,
      reason,
      costUsd: job.spentUsd,
      branchUrl: job.branchUrl,
      at: this.o.now(),
    });
  }

  private complete(job: Job, outcome: StepOutcome): void {
    const step = job.steps[job.stepIndex];
    const cost = typeof outcome.costUsd === "number" ? outcome.costUsd : 0;
    this.addSpentToday(cost);
    const results = [
      ...job.results,
      {
        step,
        ok: !!outcome.ok,
        costUsd: cost,
        costMeasured: outcome.costMeasured !== false,
        terminalReason: outcome.terminalReason,
        subtype: outcome.subtype,
        sessionId: outcome.sessionId,
        at: this.o.now(),
      },
    ];
    const base = {
      results,
      spentUsd: job.spentUsd + cost,
      branchUrl: outcome.branchUrl ?? job.branchUrl,
      pid: undefined,
      pgid: undefined,
    };

    // A cap or the clock ending a run is `stopped` — never `failed`.
    // Under tight caps this is a common, healthy outcome, and a reader
    // who cannot tell it from a broken agent will ignore both.
    if (outcome.terminalReason === "budget" || outcome.terminalReason === "timeout") {
      const stopped = this.o.store.update(job.id, {
        ...base,
        state: "stopped",
        stopReason: outcome.terminalReason,
        finishedAt: this.o.now(),
        error: outcome.error,
      });
      this.announce(stopped ?? job, "stopped", step, outcome.terminalReason);
      return;
    }
    if (!outcome.ok) {
      const failed = this.o.store.update(job.id, {
        ...base,
        state: "failed",
        finishedAt: this.o.now(),
        error: outcome.error ?? outcome.terminalReason,
      });
      this.announce(failed ?? job, "failed", step, outcome.error ?? outcome.terminalReason);
      return;
    }

    const nextIndex = job.stepIndex + 1;
    if (nextIndex >= job.steps.length) {
      const done = this.o.store.update(job.id, {
        ...base,
        state: "done",
        stepIndex: nextIndex - 1,
        finishedAt: this.o.now(),
      });
      this.announce(done ?? job, "finished", step);
      return;
    }
    if (step && job.gateAfter.includes(step)) {
      const parked = this.o.store.update(job.id, { ...base, state: "awaiting-approval", stepIndex: nextIndex });
      this.announce(parked ?? job, "gate", step);
      return;
    }
    this.o.store.update(job.id, { ...base, state: "queued", stepIndex: nextIndex });
  }
}
