// The scheduler: a configurable number of jobs at
// once, every step bounded before it starts, and a restart reconciled
// rather than guessed at.
//
// Several jobs run at once. `aide-run-spec` gives each run its own
// `git worktree`, so two at once cannot switch the real working tree of
// a repo under each other and produce wrong commits. That makes the slot
// count just a number — and the number lives in the queue config, for the
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

import { getCliErrorMessage, getNoProgressMessage, getRunnerMessage, getRunStopMessage } from "../../messages/jobs/outcomes.ts";
import { gitFailureMessage } from "./git-failure.ts";
import type { NotifyEvent } from "../../integrations/notify.ts";
import { formatSentence, type BoardMessage, type Sentence } from "../../messages/format.ts";
import { stepButton } from "../../format/step-label.ts";
import { queuePriorityOrder, type Job, type WorkflowStep } from "../queue.ts";
import { modelIdOf, tokenUsage, type RunnerOptions, type StepOutcome } from "./types.ts";
import { isRunStop } from "../steps.ts";
import { resolveStepModel } from "../model-name.ts";
import { stepDetail, getStepFailureMessage } from "../../messages/jobs/failure.ts";
import { endUntickedArchive } from "./unticked-archive.ts";
import { clearStaleHolds, holdFor, holdJob, type HoldAnswers } from "./holds.ts";
import { holdLanding } from "./landing.ts";
import { usageLimitWait } from "./usage-limit.ts";
import { afterStep, endStep, stepResultEntry } from "./step-result.ts";
import { aiWorkRetryDecision, attemptOf, attemptsLeft, queueVanishedRetry, stepRetryRecord } from "./retry.ts";

export type { SpawnResult, Spawner, StepOutcome, RunnerOptions } from "./types.ts";

export class Runner {
  private readonly o: RunnerOptions;
  private maxConcurrent: number;
  private day: string;
  private spentTokens = 0;

  constructor(opts: RunnerOptions) {
    this.o = opts;
    this.maxConcurrent = opts.maxConcurrent && opts.maxConcurrent > 0 ? opts.maxConcurrent : 1;
    this.day = opts.today();
  }

  /** How many steps may run at once, as the queue uses it right now. */
  get concurrency(): number {
    return this.maxConcurrent;
  }

  /** Settings' Save, used from the next tick: a running step is never
   *  stopped for it. Anything but a whole number above 0 is ignored,
   *  since NaN here would let every queued job start. */
  setConcurrency(n: number): void {
    if (Number.isInteger(n) && n > 0) this.maxConcurrent = n;
  }

  // --- the day's total ------------------------------------------------------

  /** The day's total in the unit a subscription meters —
   *  it is a figure the page shows, nothing here gates on it. */
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
    this.spentTokens = 0;
  }

  private rollDay(): void {
    const today = this.o.today();
    if (today !== this.day) {
      this.day = today;
      this.spentTokens = 0;
    }
  }

  // --- starting work --------------------------------------------------------

  private runningJobs(): Job[] {
    return this.o.store.list().filter((j) => j.state === "running");
  }

  /** Fill every free slot, oldest queued job first. Answers that need git,
   * provider state or spec files are computed by serve immediately before
   * this call; the runner asks every hold through one ordered list. */
  tick(answers: HoldAnswers = {}): void {
    // Every sentence this pass writes, by job id. What is NOT in it is
    // no longer held for anything, and `clearStaleHolds` takes its
    // sentence off the row: a hold-back reason is only ever the reason
    // RIGHT NOW. Left to the old code, the sentence a gate wrote stayed
    // until some other gate happened to overwrite it — so a row read
    // "another archive is running in this project" long after that
    // archive had landed, and the two whole-queue pauses below wrote
    // nothing at all on their way out (2026-09-04).
    const heldNow = new Set<string>();
    const hold = (job: Job, reason: BoardMessage): void => holdJob(this.o.store, heldNow, job, reason);

    // No job waits on a landing any more. A landing used to merge in the
    // SHARED main checkout — `git switch`, then the project's whole
    // suite on the result — and that is the directory a starting run
    // reads before it cuts its own worktree, so every job for the
    // project had to be held for the five and a half minutes it took
    // (held per repo, not for the whole board; it could
    // not narrow it further, because every job for a project touches
    // both of its repos).
    //
    // The landing merges in a worktree of its own now
    // (`mergeBranchIntoDefault`). The shared checkout is asked
    // questions, and fast-forwarded once at the end in well under a
    // second — nothing a run's own start can be caught by. So the hold
    // that existed for it is gone, and the board runs its six at once.
    // Ended on the spot with the refusal it would get, taking no slot,
    // rather than held behind another archive with two reasons on one
    // row. Never started later by a tick: a person presses Archive.
    for (const job of this.o.store.list()) {
      if (job.state === "queued" && !job.landing && answers.acceptanceOpen?.has(job.id)) {
        endUntickedArchive(this.o.store, job, this.o.now());
      }
    }
    // Quick steps first, oldest first within each group; list() is newest-first.
    for (const job of queuePriorityOrder([...this.o.store.list()].reverse())) {
      if (job.state !== "queued") continue;
      const held = holdFor(job, {
        jobs: () => this.o.store.list(),
        maxConcurrent: this.maxConcurrent,
        now: this.o.now(),
        answers,
      });
      if (held) {
        if (held.reason) hold(job, held.reason);
        continue;
      }
      this.startOne(job);
    }
    clearStaleHolds(this.o.store, heldNow);
  }

  /** Start one job's next step. Returns whether a slot was taken. */
  private startOne(job: Job): boolean {
    const step = job.steps[job.stepIndex];
    if (!step) {
      this.o.store.transition(job.id, "no-step-left", { finishedAt: this.o.now() });
      return false;
    }

    const resultFile = `${this.o.resultDir}/${job.id}.json`;
    // One id per STEP, not per job: two steps of the same job are two
    // separate claude sessions, and reusing an id would make the live
    // panel follow the wrong one.
    //
    // The FILE is per step for the same reason. `StepResult.streamFile`
    // is recorded per step so a finished step stays readable after the
    // next one has started — but with one file per job, the next step
    // overwrote the transcript that pointer names, and a three-step
    // job kept only its last step's. The one you want when a job took
    // an hour is implement's, and it was always the one gone.
    // A job that ran before this keeps whatever path it recorded, so
    // its own log still opens.
    // A step started again after a usage-limit stop is a later attempt of
    // the same step in this job, and keeps the earlier attempt's log.
    const attempt = Math.max(
      job.results.filter((r) => r.step === step).length + 1,
      attemptOf(job, step),
    );
    const streamFile = `${this.o.resultDir}/${job.id}.${step}${attempt > 1 ? `.${attempt}` : ""}.stream.jsonl`;
    const sessionId = (this.o.newSessionId ?? (() => crypto.randomUUID()))();
    this.o.clearResult?.(resultFile);
    const { pid, pgid } = this.o.spawn(job, step, resultFile, sessionId, streamFile);
    this.o.store.transition(job.id, "start", {
      pid,
      pgid,
      resultFile,
      sessionId,
      streamFile,
      startedAt: job.startedAt ?? this.o.now(),
      // Fresh every call, unlike `startedAt` above — this step's own start,
      // not the job's.
      stepStartedAt: this.o.now(),
      error: undefined,
      errorReason: undefined,
      retry: job.retry?.action === step ? job.retry : undefined,
    });
    return true;
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
        if (queueVanishedRetry(this.o, job)) continue;
        endStep(this.o.store, job.id, "process-gone", {
          finishedAt: this.o.now(),
          error: { key: "runner.runVanished", values: { button: stepButton(job.steps[job.stepIndex]!) } },
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
        if (queueVanishedRetry(this.o, job)) continue;
        endStep(this.o.store, job.id, "process-gone", {
          finishedAt: this.o.now(),
          error: { key: "runner.serverRestarted", values: { button: stepButton(job.steps[job.stepIndex]!) } },
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
    // Read as defensively as the cost above, and with one more question
    // asked: a cost that is missing defaults to 0, a token count that is
    // missing stays missing. There is nothing to default it to.
    const tokens = tokenUsage(outcome.tokens);
    if (tokens) this.addSpentTokensToday(tokens.total);
    const modelId = modelIdOf(outcome.modelId);
    // BEFORE `results` is built: whether this step's own `at` is written
    // now or deferred until its landing settles is known
    // while the entry is constructed. BEFORE the state transitions
    // below too, and folded into every one of them: a hook that took
    // ownership of a landing must have its flag set in the same call
    // stack that would otherwise free this job's concurrency slot. A
    // `tick()` interleaved between the two would see a job that is
    // merely `done` and start something else against the checkout the
    // landing is writing to.
    const landingWork = this.o.onStepDone?.(job, step, outcome);
    // The index this step's own entry will occupy — captured so the
    // settle callback below can find it again without searching by
    // name, which a re-run of the same step later in this job's life
    // could make ambiguous.
    const resultIndex = job.results.length;
    const measures = { cost, tokens, modelId, at: landingWork ? undefined : this.o.now() };
    const results = [...job.results, stepResultEntry(job, step, outcome, measures, this.o.store.defaults)];
    // Against the choice the step ran on: what the pickers say an alias gives today.
    if (modelId) this.o.store.recordModelId(resolveStepModel(job, step, this.o.store.defaults.model), modelId);
    const landing = landingWork
      ? holdLanding(this.o.store, job.id, landingWork, { index: resultIndex, step, now: this.o.now })
      : undefined;
    const base = { ...afterStep(job, outcome, results, measures), ...landing?.patch };

    const retryAttempts = attemptOf(job, step);
    const retry = stepRetryRecord(job, step, outcome, Date.parse(this.o.now()));
    if (retry) {
      endStep(this.o.store, job.id, "retry", {
        ...base,
        retry,
        finishedAt: undefined,
        error: undefined,
        errorReason: undefined,
      });
      return;
    }

    // The clock, a usage limit or the criteria checks ending a run is
    // `stopped` — never `failed`: a common, healthy outcome, and a reader
    // who cannot tell it from a broken agent will ignore both.
    if (isRunStop(outcome.terminalReason)) {
      const stoppedAt = this.o.now();
      const stopMessage = getRunStopMessage(step, outcome, resolveStepModel(job, step, this.o.store.defaults.model));
      const worded = stopMessage && attemptsLeft(retryAttempts) === 0 && outcome.terminalReason === "timeout"
        ? { key: "runner.afterTwoTimeouts" as const, inner: stopMessage }
        : stopMessage;
      const result = endStep(this.o.store, job.id, "run-stopped", {
        ...base,
        stopReason: outcome.terminalReason,
        ...usageLimitWait(outcome, stoppedAt),
        finishedAt: stoppedAt,
        error: worded ?? getRunnerMessage(outcome),
        errorDetail: worded ? stepDetail(outcome) : undefined,
      });
      this.announce(result.ok ? result.job : job, "stopped", step, outcome.terminalReason);
      return;
    }
    if (!outcome.ok) {
      const baseMessage = getNoProgressMessage(step, outcome) ?? getCliErrorMessage(step, outcome) ?? gitFailureMessage(outcome);
      const finalMessage = attemptsLeft(retryAttempts) === 0 && aiWorkRetryDecision(
        { terminalReason: outcome.terminalReason ?? "", scopeViolation: outcome.scopeViolation }, retryAttempts - 1,
      ) && baseMessage && !Array.isArray(baseMessage) && typeof baseMessage !== "string"
        ? { key: "runner.afterTwoAttempts" as const, inner: baseMessage }
        : baseMessage;
      const failure = getStepFailureMessage(
        finalMessage,
        outcome,
        job.model[step] ?? job.modelChoice,
      );
      const result = endStep(this.o.store, job.id, "step-failed", {
        ...base,
        finishedAt: this.o.now(),
        error: failure.error,
        errorDetail: failure.errorDetail,
        // A conflict found HERE — at step start, by the runner — has to
        // reach the job the same way a landing's conflict does, so the
        // failure is stored as what it IS rather than as an unexplained
        // refusal. Undefined for every other one, which is what clears a
        // reason left by an earlier attempt.
        errorReason: outcome.errorReason,
      });
      // The notifier gets a sentence: the runner's own where it sent one, else the board's, in English.
      const reason = outcome.error ?? formatSentence("en", failure.error as Sentence | Sentence[] | undefined);
      this.announce(result.ok ? result.job : job, "failed", step, reason ?? outcome.terminalReason);
      return;
    }

    const nextIndex = job.stepIndex + 1;
    if (nextIndex >= job.steps.length) {
      const result = endStep(this.o.store, job.id, "step-succeeded-last", {
        ...base,
        retry: landingWork ? job.retry : undefined,
        stepIndex: nextIndex - 1,
        finishedAt: this.o.now(),
      });
      this.announce(result.ok ? result.job : job, "finished", step);
      return;
    }
    // A step used to be able to PARK the job here, waiting for a person
    // to press Approve. There is no such stop: every step lands the
    // work it produced, so there is nothing between two steps for anyone
    // to weigh, and the next step is simply queued.
    endStep(this.o.store, job.id, "step-succeeded", {
      ...base,
      retry: undefined,
      stepIndex: nextIndex,
    });
  }
}
