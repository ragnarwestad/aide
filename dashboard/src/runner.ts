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

import type { NotifyEvent } from "./notify.ts";
import {
  mergeBranchRefs,
  type BranchRef,
  type Job,
  type QueueStore,
  type TokenUsage,
  type WorkflowStep,
} from "./queue.ts";

export interface SpawnResult {
  pid: number;
  pgid: number;
}

// The session id and the stream file are decided HERE and handed down,
// not learned from the result afterwards: by the time a result exists
// the step is over, and there is nothing left to watch.
export type Spawner = (
  job: Job,
  step: WorkflowStep,
  resultFile: string,
  sessionId: string,
  streamFile: string,
) => SpawnResult;

export interface StepOutcome {
  ok: boolean;
  /** Absent for a step whose tool publishes no dollar figure at all —
   *  a Codex step, always (spec 125). Absent is not zero: zero would be
   *  summed into the job's spend as if the step had been free. */
  costUsd?: number;
  costMeasured: boolean;
  /** Which CLI `aide-run-spec` actually started. */
  tool?: "claude" | "codex";
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  /** The compare or PR page for the branch this step wrote to, when the
   *  push mode produced one. One link: `aide-run-spec`'s own "single
   *  most interesting one". */
  branchUrl?: string;
  /** Every repo the step pushed to, one entry each. `aide-run-spec`
   *  emits this right beside `branchUrl` in the same object; reading
   *  only the singular neighbour is what left a two-repo job showing
   *  one link and one merge state for both. */
  branchUrls?: BranchRef[];
  /** The branch this step's work is on. `aide-run-spec` has emitted it
   *  in every result since spec 81 and nothing read it until spec 93 —
   *  a create job's branch is named after a provisional key, so it
   *  cannot be re-derived from the spec folder the way every other
   *  job's can. */
  branch?: string;
  /** The spec folder a `create` step turned out to make. Reported only
   *  when exactly one appeared; absent means the run would have had to
   *  guess, and it did not. */
  specFolder?: string;
  /** What the step metered (spec 118). Absent whenever the run could not
   *  measure it — there is no over-charge rule for tokens the way there
   *  is for cost, so absent is the only other answer. */
  tokens?: TokenUsage;
  error?: string;
  /** WHY it was refused, when the answer is one the page acts on (spec
   *  153). `"conflict"` — the runner could not bring the spec's branch
   *  up to date with the base before the step started — is the only one
   *  today, and it is what makes the row offer Resolve. Same field, same
   *  value, same button as a LANDING's conflict (`Job["errorReason"]`);
   *  the two discovery points differ in nothing else. Absent for every
   *  other refusal: there is no step to send at those. */
  errorReason?: "conflict";
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
  /** The session id a step will run under. Injected like the clock, so a
   *  test can assert on the id it chose rather than on "some string". */
  newSessionId?: () => string;
  /** Every ENDING is announced: a gate, a finish, a stop, a failure. A
   *  job that parked at 02:00 must not wait for someone to open the
   *  page. Injected, so the tests spawn nothing. */
  notify?: (event: NotifyEvent) => void;
  /** Called once per FINISHED step, ok or not, with what the run
   *  reported — the injection point `notify` already established, for a
   *  caller that has to act on one step's outcome rather than merely
   *  announce it (spec 93 lands a created spec through it).
   *
   *  Returning a PROMISE means "I have started work that outlives this
   *  call, against state the queue shares": the job is marked `landing`
   *  in the same call stack as the state transition below, and no job of
   *  any kind is started until that promise settles. The window is real
   *  — `complete()` is synchronous and frees the job's slot the instant
   *  the step reports success, while the awaited git work the hook
   *  started is still switching branches in a checkout no worktree
   *  isolates.
   *
   *  The runner sets AND clears the flag, rather than trusting the hook
   *  to do both: a hook whose body happened to finish without awaiting
   *  anything would otherwise clear a flag that had not been set yet,
   *  and the queue would be held shut by nobody. A continuation on the
   *  returned promise cannot run earlier than the next microtask, so
   *  that ordering is guaranteed rather than reasoned about. */
  onStepDone?: (
    job: Job,
    step: WorkflowStep | undefined,
    outcome: Partial<StepOutcome>,
  ) => void | Promise<unknown>;
  /** How many steps may be in flight at once. 1 reproduces the
   *  behaviour every caller had before spec 91, which is what makes a
   *  rollback a config edit rather than a release. */
  maxConcurrent?: number;
}

/** The result file is another process's JSON, so this field is a
 *  question like every other one: an object with five numbers, or
 *  nothing. Anything else — a string, a partial object, a null — is
 *  dropped rather than half-carried into a figure a reader would
 *  believe. */
function tokenUsage(raw: unknown): TokenUsage | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const keys = ["input", "output", "cacheRead", "cacheCreation", "total"] as const;
  if (keys.some((k) => typeof r[k] !== "number")) return undefined;
  return {
    input: r.input as number,
    output: r.output as number,
    cacheRead: r.cacheRead as number,
    cacheCreation: r.cacheCreation as number,
    total: r.total as number,
  };
}

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
   *  nothing to do with dependencies. */
  tick(blocked?: Map<string, string>): void {
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
      const reason = `the job cap ($${job.jobCapUsd}) would be exceeded by the next step`;
      const stopped = this.o.store.update(job.id, {
        state: "stopped",
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
        error: `held back: the daily cap ($${this.o.store.defaults.dailyCapUsd}) would be exceeded`,
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
          error: "the run vanished without leaving a result",
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
        // The row draws Resolve off this and nothing else (spec 149), so
        // a conflict found HERE — at step start, by the runner — has to
        // reach the job the same way a landing's conflict does. Without
        // it the row read "press Run to try again", which fails
        // identically. Undefined for every other refusal, which is what
        // clears a reason left by an earlier attempt.
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
