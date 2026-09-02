// The scheduler (spec 81, slice 81b): a configurable number of jobs at
// once, every step bounded before it starts, and a restart reconciled
// rather than guessed at.
//
// It ran one job at a time until spec 91, for one reason: every run
// switched the real working tree of every repo it touched, so two at
// once would have produced wrong commits rather than faster runs. Once
// `aide-run-spec` gives each run its own `git worktree`, the slot count
// is just a number — and the number lives in the queue config, for the
// reason `queue.ts` gives about every other number there.
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
//
// The types (SpawnResult, Spawner, StepOutcome, RunnerOptions) and the
// tokenUsage helper live in runner/types.ts (split runner.ts by
// theme); the Runner class itself — the only stateful piece — stays
// here, re-exporting them for every existing importer.

import type { NotifyEvent } from "../integrations/notify.ts";
import { errorSentence } from "../render/ui/error-sentence.ts";
import { mergeBranchRefs, type Job, type WorkflowStep } from "./queue.ts";
import { tokenUsage, type RunnerOptions, type StepOutcome } from "./runner/types.ts";

export type { SpawnResult, Spawner, StepOutcome, RunnerOptions } from "./runner/types.ts";

export class Runner {
  private readonly o: RunnerOptions;
  private readonly maxConcurrent: number;
  private day: string;
  private spent = 0;
  private spentTokens = 0;

  constructor(opts: RunnerOptions) {
    this.o = opts;
    this.maxConcurrent = opts.maxConcurrent && opts.maxConcurrent > 0 ? opts.maxConcurrent : 1;
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

  /** The same day's total in the unit a subscription meters (spec 118).
   *  Its own accumulator beside the cost, because the two are not
   *  convertible: a step reports one, both or neither. Only the caps are
   *  in dollars, so nothing here gates on this — it is a figure the page
   *  shows. */
  spentTokensToday(): number {
    this.rollDay();
    return this.spentTokens;
  }

  addSpentTokensToday(tokens: number): void {
    this.rollDay();
    this.spentTokens += tokens;
  }

  /** Test seam for the midnight boundary. */
  setToday(day: string): void {
    this.day = day;
    this.spent = 0;
    this.spentTokens = 0;
  }

  private rollDay(): void {
    const today = this.o.today();
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
      this.spentTokens = 0;
    }
  }

  // --- starting work --------------------------------------------------------

  private runningJobs(): Job[] {
    return this.o.store.list().filter((j) => j.state === "running");
  }

  /** Fill every free slot, oldest queued job first.
   *
   *  `blocked` maps a job id to the folder of the dependency it is
   *  waiting for (spec 122). The Runner takes the answer rather than
   *  working it out: whether a dependency has merged is a live git
   *  question, and `serve.ts` — which owns the git runner and knows
   *  which steps a dependency holds back — computes it fresh
   *  immediately before every call. Asking here would make `tick()`
   *  async, and with it every call site and every test that has
   *  nothing to do with dependencies.
   *
   *  `notAnalyzed` is `blocked`'s sibling (spec 344): a job id SET, not
   *  a Map, since the reason it names carries no per-job detail — every
   *  job in it gets the identical fixed sentence, unlike a dependency's
   *  own folder name. */
  tick(blocked?: Map<string, string>, notAnalyzed?: Set<string>): void {
    // NOTHING starts while a job is landing, whatever it is and whatever
    // repo it is for. A landing merges directly into the SHARED main
    // checkout — the one every run switches and reads at its own start —
    // and worktree isolation (spec 91) protects a run's work from other
    // runs, not that checkout from a landing writing to it. Queue-wide
    // rather than per repo: a job's target repos are only known once
    // `aide-run-spec` has resolved them, which is after it has started.
    // At one operator, over-serializing costs seconds; the race costs a
    // half-merged working tree.
    if (this.o.store.list().some((j) => j.landing)) return;
    // FIFO: list() is newest-first.
    for (const job of [...this.o.store.list()].reverse()) {
      if (this.runningJobs().length >= this.maxConcurrent) return;
      if (job.state !== "queued") continue;
      // Two jobs for the SAME spec are never both started: analyze and
      // implement for one spec are ordered by nature, and git would
      // refuse the second worktree on that branch anyway — which is a
      // refusal mid-run, not a scheduling decision.
      if (this.runningJobs().some((r) => r.project === job.project && r.specFolder === job.specFolder)) {
        continue;
      }
      // Cheaper and more fundamental than the dependency question below —
      // checked first, and it needs no network call (spec 344).
      if (notAnalyzed?.has(job.id)) {
        const reason = "held back: not analyzed yet — run /aide-analyze first";
        if (job.error !== reason) this.o.store.update(job.id, { error: reason });
        continue;
      }
      // Held back, not failed — the same shape `startOne`'s daily-cap
      // check uses one call down: the reason is written, the state is
      // left alone, no slot is taken, and the next tick tries again. It
      // used to start, be refused by `aide-run-spec` and land in
      // `failed`, which nothing retries.
      const dependency = blocked?.get(job.id);
      if (dependency !== undefined) {
        const reason = `held back: depends on ${dependency}, whose branch is not merged yet`;
        // Only when it changed: an unconditional update would rewrite
        // the mirror every two seconds for a job that is doing nothing.
        if (job.error !== reason) this.o.store.update(job.id, { error: reason });
        continue;
      }
      this.startOne(job);
    }
  }

  /** Start one job's next step, unless a cap holds it back. Returns
   *  whether a slot was taken — a job the daily cap stops must not
   *  consume one, and must not block a cheaper job behind it either. */
  private startOne(job: Job): boolean {
    const step = job.steps[job.stepIndex];
    if (!step) {
      this.o.store.update(job.id, { state: "done", finishedAt: this.o.now() });
      return false;
    }

    // Both caps are checked BEFORE the step starts: a cap that only
    // stops you afterwards is a report, not a cap.
    if (job.spentUsd + job.budgetUsd > job.jobCapUsd) {
      const reason = errorSentence({
        what: `the job cap ($${job.jobCapUsd}) would be exceeded by the next step.`,
        resolve: "Raise the job cap in the project's .aide/config, then press Run again.",
      }).text;
      const stopped = this.o.store.update(job.id, {
        state: "stopped",
        stopReason: "job-cap",
        finishedAt: this.o.now(),
        error: reason,
      });
      this.announce(stopped ?? job, "stopped", step, reason);
      return false;
    }
    // The budgets of jobs ALREADY IN FLIGHT count. `spentToday()` is the
    // sum of what has been recorded, and recording happens at
    // completion — so with N slots, N jobs could each pass this check on
    // the same numbers and the cap be exceeded by (N-1) budgets before
    // anything noticed.
    if (this.reservedUsd() + job.budgetUsd > this.o.store.defaults.dailyCapUsd) {
      this.o.store.update(job.id, {
        error: errorSentence({
          what: `held back: the daily cap ($${this.o.store.defaults.dailyCapUsd}) would be exceeded.`,
          resolve: "Raise the daily cap in the project's .aide/config, or wait for it to reset tomorrow.",
        }).text,
      });
      return false;
    }

    const resultFile = `${this.o.resultDir}/${job.id}.json`;
    // One id per STEP, not per job: two steps of the same job are two
    // separate claude sessions, and reusing an id would make the live
    // panel follow the wrong one.
    const streamFile = `${this.o.resultDir}/${job.id}.stream.jsonl`;
    const sessionId = (this.o.newSessionId ?? (() => crypto.randomUUID()))();
    this.o.clearResult?.(resultFile);
    const { pid, pgid } = this.o.spawn(job, step, resultFile, sessionId, streamFile);
    this.o.store.update(job.id, {
      state: "running",
      pid,
      pgid,
      resultFile,
      sessionId,
      streamFile,
      startedAt: job.startedAt ?? this.o.now(),
      error: undefined,
    });
    return true;
  }

  /** Today's spend plus the budgets of the steps currently in flight.
   *  Derived, never stored: a job that dies is resolved by `poll()` or
   *  `reconcile()`, and its reservation disappears with its state. */
  private reservedUsd(): number {
    return this.runningJobs().reduce((sum, j) => sum + j.budgetUsd, this.spentToday());
  }

  // --- finishing work -------------------------------------------------------

  /** Look at EVERY running job: has its result landed? Reading only the
   *  first would leave the second's step sitting in `running` with its
   *  result on disk beside it until the first finished. */
  poll(): void {
    for (const job of this.runningJobs()) {
      if (!job.resultFile) continue;
      const raw = this.o.readResult(job.resultFile);
      if (raw) {
        this.complete(job, raw as Partial<StepOutcome>);
        continue;
      }
      // No result yet. If the process is also gone, the run died without
      // leaving one — see reconcile().
      if (job.pid !== undefined && !this.o.isAlive(job.pid)) {
        this.o.store.update(job.id, {
          state: "interrupted",
          finishedAt: this.o.now(),
          sessionId: undefined,
          error: errorSentence({
            what: "the run vanished without leaving a result.",
            resolve: "Press Run again.",
          }).text,
        });
      }
    }
  }

  /** On boot: a job left `running` is resolved, never assumed. */
  reconcile(): void {
    for (const job of this.o.store.list()) {
      if (job.state !== "running") continue;
      if (job.pid !== undefined && this.o.isAlive(job.pid)) continue; // still going — keep watching
      const raw = job.resultFile ? this.o.readResult(job.resultFile) : null;
      if (raw) {
        this.complete(job, raw as Partial<StepOutcome>);
      } else {
        this.o.store.update(job.id, {
          state: "interrupted",
          finishedAt: this.o.now(),
          sessionId: undefined,
          error: errorSentence({
            what: "the server restarted while this step was running, and it left no result.",
            resolve: "Press Run again.",
          }).text,
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

  // `Partial`, and deliberately so: the outcome is whatever JSON another
  // process left in the result file, so every field is a question rather
  // than a promise. That is what makes `!!outcome.ok` and
  // `costMeasured !== false` load-bearing instead of noise — an IDE
  // inspection offering to "simplify" them is offering to turn a missing
  // flag into the wrong answer.
  private complete(job: Job, outcome: Partial<StepOutcome>): void {
    const step = job.steps[job.stepIndex];
    const cost = typeof outcome.costUsd === "number" ? outcome.costUsd : 0;
    this.addSpentToday(cost);
    // Read as defensively as the cost above, and with one more question
    // asked: a cost that is missing defaults to 0, a token count that is
    // missing stays missing. There is nothing to default it to.
    const tokens = tokenUsage(outcome.tokens);
    if (tokens) this.addSpentTokensToday(tokens.total);
    const results = [
      ...job.results,
      {
        step,
        ok: !!outcome.ok,
        costUsd: cost,
        // Read as defensively as everything else here, and narrowed to
        // the two names the page knows how to route on: whatever else
        // a result file says, it is not a tool this dashboard can
        // render for.
        tool: (outcome.tool === "codex" ? "codex" : "claude") as "claude" | "codex",
        tokens,
        costMeasured: outcome.costMeasured !== false,
        terminalReason: outcome.terminalReason ?? "no reason recorded",
        subtype: outcome.subtype,
        // What the run reported, or failing that the id we gave it — a
        // step whose result carried no session was still run under one.
        sessionId: outcome.sessionId ?? job.sessionId,
        streamFile: job.streamFile,
        at: this.o.now(),
      },
    ];
    // BEFORE the state transitions below, and folded into every one of
    // them: a hook that took ownership of a landing must have its flag
    // set in the same call stack that would otherwise free this job's
    // concurrency slot. A `tick()` interleaved between the two would see
    // a job that is merely `done` and start something else against the
    // checkout the landing is writing to.
    const landingWork = this.o.onStepDone?.(job, step, outcome);
    const landing = landingWork ? true : undefined;
    if (landingWork) {
      void Promise.resolve(landingWork).then(
        () => this.o.store.update(job.id, { landing: undefined }),
        () => this.o.store.update(job.id, { landing: undefined }),
      );
    }
    const base = {
      results,
      landing,
      spentUsd: job.spentUsd + cost,
      // Undefined until something measures one: a job of steps that all
      // predate spec 118 shows a dash, not a zero.
      spentTokens:
        tokens || job.spentTokens !== undefined
          ? (job.spentTokens ?? 0) + (tokens?.total ?? 0)
          : undefined,
      branchUrl: outcome.branchUrl ?? job.branchUrl,
      // Kept across steps the same way `branchUrl` is (spec 220): the
      // request belongs to the CODE branch, which `implement` pushes and
      // `archive` never touches, so the step that ends the job is not
      // the step that opened it.
      prUrl: outcome.prUrl ?? job.prUrl,
      prError: outcome.prError ?? job.prError,
      pushError: outcome.pushError ?? job.pushError,
      // Accumulated BY ROOT, never replaced: a step that pushed to one
      // repo must not erase the repo an earlier step pushed to.
      branchUrls: mergeBranchRefs(job.branchUrls, outcome.branchUrls),
      pid: undefined,
      pgid: undefined,
      // The step is over: nothing is live under this id any more, and a
      // page that kept showing it would say the job is still working.
      sessionId: undefined,
    };

    // A cap or the clock ending a run is `stopped` — never `failed`.
    // Under tight caps this is a common, healthy outcome, and a reader
    // who cannot tell it from a broken agent will ignore both.
    if (
      outcome.terminalReason === "budget" || outcome.terminalReason === "timeout" ||
      outcome.terminalReason === "provider-limit"
    ) {
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
        // A conflict found HERE — at step start, by the runner — has to
        // reach the job the same way a landing's conflict does, so the
        // failure is stored as what it IS rather than as an unexplained
        // refusal. Undefined for every other one, which is what clears a
        // reason left by an earlier attempt.
        errorReason: outcome.errorReason,
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
    // A step used to be able to PARK the job here, waiting for a person
    // to press Approve. Spec 149 removed the stop: every step lands the
    // work it produced, so there is nothing between two steps for anyone
    // to weigh, and the next step is simply queued.
    this.o.store.update(job.id, { ...base, state: "queued", stepIndex: nextIndex });
  }
}
