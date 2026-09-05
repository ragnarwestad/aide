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

import { specNumber } from "../project/spec-folder.ts";
import type { NotifyEvent } from "../integrations/notify.ts";
import { renderMessage, type BoardMessage } from "../i18n/message.ts";
import { mergeBranchRefs, queuePriorityOrder, type Job, type WorkflowStep } from "./queue.ts";
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

  /** Every repo a job for this project could reach: the code root
   *  always, and the specs root beside it only when the project keeps
   *  specs in a repo of their own (spec 402) — the same two paths
   *  `land-branch/merge.ts`'s own `codeRoots` set already resolves a
   *  landing's gate against. A project that keeps specs inside its own
   *  code repo collapses to one root, so it never collides with
   *  anything beyond itself. */
  private repoRootsFor(project: string): string[] {
    const code = this.o.projectDir(project);
    const specs = this.o.specsRoot?.(project) ?? code;
    return specs === code ? [code] : [code, specs];
  }

  /** Fill every free slot, oldest queued job first.
   *
   *  `blocked` maps a job id to the folder of the dependency it is
   *  waiting for (spec 122). The Runner takes the answer rather than
   *  working it out: whether a dependency is archived (spec 351) is a
   *  live git question, and `serve.ts` — which owns the git runner and
   *  knows which steps a dependency holds back — computes it fresh
   *  immediately before every call. Asking here would make `tick()`
   *  async, and with it every call site and every test that has
   *  nothing to do with dependencies.
   *
   *  `notAnalyzed` is `blocked`'s sibling (spec 344): a job id SET, not
   *  a Map, since the reason it names carries no per-job detail — every
   *  job in it gets the identical fixed sentence, unlike a dependency's
   *  own folder name. */
  tick(blocked?: Map<string, string>, notAnalyzed?: Set<string>, acceptanceOpen?: Set<string>): void {
    // Every sentence this pass writes, by job id. What is NOT in it is
    // no longer held for anything, and `clearStaleHolds` takes its
    // sentence off the row: a hold-back reason is only ever the reason
    // RIGHT NOW. Left to the old code, the sentence a gate wrote stayed
    // until some other gate happened to overwrite it — so a row read
    // "another archive is running in this project" long after that
    // archive had landed, and the two whole-queue pauses below wrote
    // nothing at all on their way out (2026-09-04).
    const held = (this.heldThisPass = new Set<string>());
    const hold = (job: Job, reason: BoardMessage): void => this.hold(job, reason);

    // A landing merges directly into the SHARED main checkout — the one
    // every run switches and reads at its own start — and worktree
    // isolation (spec 91) protects a run's work from other runs, not
    // that checkout from a landing writing to it. Scoped to the repos a
    // landing ACTUALLY occupies (spec 402): WHICH of a project's own
    // repos a step reaches is unknown until `aide-run-spec` has resolved
    // them, after it has started — but WHICH repos the project HAS is
    // known now, from the same two resolvers the lock and the landing's
    // own gate already use. A job whose repos are disjoint from every
    // one of them reads nothing a landing anywhere else on the board is
    // writing to.
    const repoCache = new Map<string, string[]>();
    const rootsFor = (project: string): string[] => {
      const cached = repoCache.get(project);
      if (cached) return cached;
      const roots = this.repoRootsFor(project);
      repoCache.set(project, roots);
      return roots;
    };
    const landingRepos = new Set<string>();
    for (const j of this.o.store.list()) {
      if (j.landing) for (const root of rootsFor(j.project)) landingRepos.add(root);
    }

    // Quick steps before slow ones, oldest first within each group
    // (REQ-1); list() is newest-first.
    for (const job of queuePriorityOrder([...this.o.store.list()].reverse())) {
      // Every slot is busy. The row says so by its queue position, not
      // by a sentence — but a sentence left from an earlier pass has to
      // go, so this leaves through the same door as everything else.
      if (this.runningJobs().length >= this.maxConcurrent) {
        this.clearStaleHolds(held);
        return;
      }
      if (job.state !== "queued") continue;
      // NOTHING starts while a job in the SAME repo is landing — the
      // repos it MIGHT touch, since which ones this step will actually
      // reach is only known once `aide-run-spec` has resolved them. Not
      // exempted for the job whose OWN landing this is: its repos are
      // always in `landingRepos` too, so it is left un-started all the
      // same — only the redundant sentence is skipped, since its row
      // already reads "landing <step>" through a different path.
      if (landingRepos.size > 0 && rootsFor(job.project).some((root) => landingRepos.has(root))) {
        if (!job.landing) hold(job, { key: "runner.landingPause" });
        continue;
      }
      // Two jobs for the SAME spec are never both started: analyze and
      // implement for one spec are ordered by nature, and git would
      // refuse the second worktree on that branch anyway — which is a
      // refusal mid-run, not a scheduling decision.
      if (this.runningJobs().some((r) => r.project === job.project && r.specFolder === job.specFolder)) {
        continue;
      }
      // Two `archive` steps never run at once in the SAME project: both
      // branch from the code root's main and both land into it, and the
      // second one's landing finds a main the first moved under it. Held
      // back with the reason on the row, the same shape as the two
      // hold-backs below; the next tick tries again.
      if (
        job.steps[job.stepIndex] === "archive" &&
        this.runningJobs().some((r) => r.project === job.project && r.steps[r.stepIndex] === "archive")
      ) {
        hold(job, { key: "runner.archiveRunning" });
        continue;
      }
      // Cheaper and more fundamental than the dependency question below —
      // checked first, and it needs no network call (spec 344).
      if (notAnalyzed?.has(job.id)) {
        hold(job, { key: "runner.notAnalyzed" });
        continue;
      }
      // Held back, not failed — the same shape `startOne`'s daily-cap
      // check uses one call down: the reason is written, the state is
      // left alone, no slot is taken, and the next tick tries again. It
      // used to start, be refused by `aide-run-spec` and land in
      // `failed`, which nothing retries.
      const dependency = blocked?.get(job.id);
      if (dependency !== undefined) {
        // The NUMBER, not the folder: the row already says "depends on:
        // 393" a line above this message, from the same helper, and a
        // sentence that spells the whole folder out beside it is the
        // same fact twice at four times the width. The folder stays the
        // spec's address everywhere it IS one -- the branch, the commit
        // subjects, the spec's own Depends on.
        hold(job, { key: "runner.dependencyNotArchived", values: { dependency: specNumber(dependency) } });
        continue;
      }
      // The same shape once more, for `archive`: an acceptance row only
      // a person can tick is still open. Run, the step would only be
      // refused by `aide-archive-spec` and end the job with archive
      // unarchived — so a chained analyze/implement/archive job waits
      // here for the tick instead, and starts by itself once it lands.
      if (acceptanceOpen?.has(job.id)) {
        hold(job, { key: "runner.acceptanceCriteriaUnticked" });
        continue;
      }
      this.startOne(job);
    }
    this.clearStaleHolds(held);
  }

  /** Every job this pass held, by id — `startOne`'s own daily-cap hold
   *  included, which is why this is a field and not a local. */
  private heldThisPass = new Set<string>();

  /** Hold one job with the reason it is held for RIGHT NOW. Written
   *  only when it changed: an unconditional update would rewrite the
   *  mirror every two seconds for a job that is doing nothing. */
  private hold(job: Job, reason: BoardMessage): void {
    this.heldThisPass.add(job.id);
    // Every caller reaches this with a job that IS queued right now,
    // so the reason it holds for is always the current one — whatever
    // `errorReason` an earlier, unrelated attempt left behind (spec
    // 393: a refused landing's own record lives in `landingError`,
    // which this never touches, not in `error`/`errorReason`).
    const current = job.error;
    const same = !!current && typeof current === "object" && !Array.isArray(current) &&
      current.key === reason.key && JSON.stringify(current.values) === JSON.stringify(reason.values);
    if (!same) this.o.store.update(job.id, { error: reason, errorReason: "held-back" });
  }

  /** Take the hold-back sentence off every queued job this pass did not
   *  hold. The reason is gone; the row must not go on naming it. Only
   *  `held-back` sentences — a stopped job's own error is its record,
   *  not a wait. */
  private clearStaleHolds(held: Set<string>): void {
    for (const job of this.o.store.list()) {
      if (job.state !== "queued" || held.has(job.id)) continue;
      if (job.errorReason !== "held-back") continue;
      this.o.store.update(job.id, { error: undefined, errorReason: undefined });
    }
  }

  /** Start one job's next step, unless a cap holds it back. Returns
   *  whether a slot was taken — a job the daily cap stops must not
   *  consume one, and must not block a cheaper job behind it either. */
  private startOne(job: Job): boolean {
    const step = job.steps[job.stepIndex];
    if (!step) {
      this.o.store.transition(job.id, "no-step-left", { finishedAt: this.o.now() });
      return false;
    }

    // Both caps are checked BEFORE the step starts: a cap that only
    // stops you afterwards is a report, not a cap.
    if (job.spentUsd + job.budgetUsd > job.jobCapUsd) {
      const reason: BoardMessage = { key: "runner.jobCapExceeded", values: { cap: job.jobCapUsd } };
      const result = this.o.store.transition(job.id, "cap-hit", {
        stopReason: "job-cap",
        finishedAt: this.o.now(),
        error: reason,
      });
      this.announce(result.ok ? result.job : job, "stopped", step, renderMessage("en", reason));
      return false;
    }
    // The budgets of jobs ALREADY IN FLIGHT count. `spentToday()` is the
    // sum of what has been recorded, and recording happens at
    // completion — so with N slots, N jobs could each pass this check on
    // the same numbers and the cap be exceeded by (N-1) budgets before
    // anything noticed.
    if (this.reservedUsd() + job.budgetUsd > this.o.store.defaults.dailyCapUsd) {
      this.hold(job, { key: "runner.dailyCapExceeded", values: { cap: this.o.store.defaults.dailyCapUsd } });
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
    this.o.store.transition(job.id, "start", {
      pid,
      pgid,
      resultFile,
      sessionId,
      streamFile,
      startedAt: job.startedAt ?? this.o.now(),
      // Fresh every call, unlike `startedAt` above — this step's own start,
      // not the job's (spec 384).
      stepStartedAt: this.o.now(),
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
        this.o.store.transition(job.id, "process-gone", {
          finishedAt: this.o.now(),
          sessionId: undefined,
          error: { key: "runner.runVanished" },
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
        this.o.store.transition(job.id, "process-gone", {
          finishedAt: this.o.now(),
          sessionId: undefined,
          error: { key: "runner.serverRestarted" },
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
    // BEFORE `results` is built: whether this step's own `at` is written
    // now or deferred until its landing settles (spec 395) is known
    // while the entry is constructed. BEFORE the state transitions
    // below too, and folded into every one of them: a hook that took
    // ownership of a landing must have its flag set in the same call
    // stack that would otherwise free this job's concurrency slot. A
    // `tick()` interleaved between the two would see a job that is
    // merely `done` and start something else against the checkout the
    // landing is writing to.
    const landingWork = this.o.onStepDone?.(job, step, outcome);
    const landing = landingWork ? true : undefined;
    // The index this step's own entry will occupy — captured so the
    // settle callback below can find it again without searching by
    // name, which a re-run of the same step later in this job's life
    // could make ambiguous.
    const resultIndex = job.results.length;
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
        // A step whose work lands (spec 395, REQ-3): the clock this
        // stamp ends is the step's OWN work, and that work is not over
        // until the merge is. Written immediately only when there is
        // no landing to wait for.
        at: landingWork ? undefined : this.o.now(),
        // This step's own start (spec 384) — moves off `Job.stepStartedAt`
        // and onto the result it produced.
        startedAt: job.stepStartedAt,
      },
    ];
    if (landingWork) {
      // Runs once, whichever way the landing settles — the same
      // "always clear the flag" shape already used below, extended to
      // also close out this step's own duration at the instant its
      // work is actually done. Nothing else can extend `job.results`
      // for THIS job before this fires: `Runner.tick()` starts no job
      // at all while any job is landing (`docs/job-states.md`, "Beside
      // the state"), so `resultIndex` still names the same entry.
      const settleDuration = (): void => {
        const current = this.o.store.get(job.id);
        const entry = current?.results[resultIndex];
        if (!entry || entry.step !== step || entry.at !== undefined) return;
        const patched = [...current!.results];
        patched[resultIndex] = { ...entry, at: this.o.now() };
        this.o.store.update(job.id, { results: patched });
      };
      void Promise.resolve(landingWork).then(
        () => {
          settleDuration();
          this.o.store.update(job.id, { landing: undefined });
        },
        () => {
          settleDuration();
          this.o.store.update(job.id, { landing: undefined });
        },
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
      // Its value just moved onto the result above (spec 384); left set,
      // a job merely `queued` for its NEXT step would read as still
      // ticking from the step that already finished.
      stepStartedAt: undefined,
    };

    // A cap or the clock ending a run is `stopped` — never `failed`.
    // Under tight caps this is a common, healthy outcome, and a reader
    // who cannot tell it from a broken agent will ignore both.
    if (
      outcome.terminalReason === "budget" || outcome.terminalReason === "timeout" ||
      outcome.terminalReason === "provider-limit"
    ) {
      const result = this.o.store.transition(job.id, "run-stopped", {
        ...base,
        stopReason: outcome.terminalReason,
        finishedAt: this.o.now(),
        error: outcome.error,
      });
      this.announce(result.ok ? result.job : job, "stopped", step, outcome.terminalReason);
      return;
    }
    if (!outcome.ok) {
      const result = this.o.store.transition(job.id, "step-failed", {
        ...base,
        finishedAt: this.o.now(),
        error: outcome.error ?? outcome.terminalReason,
        // A conflict found HERE — at step start, by the runner — has to
        // reach the job the same way a landing's conflict does, so the
        // failure is stored as what it IS rather than as an unexplained
        // refusal. Undefined for every other one, which is what clears a
        // reason left by an earlier attempt.
        errorReason: outcome.errorReason,
      });
      this.announce(result.ok ? result.job : job, "failed", step, outcome.error ?? outcome.terminalReason);
      return;
    }

    const nextIndex = job.stepIndex + 1;
    if (nextIndex >= job.steps.length) {
      const result = this.o.store.transition(job.id, "step-succeeded-last", {
        ...base,
        stepIndex: nextIndex - 1,
        finishedAt: this.o.now(),
      });
      this.announce(result.ok ? result.job : job, "finished", step);
      return;
    }
    // A step used to be able to PARK the job here, waiting for a person
    // to press Approve. Spec 149 removed the stop: every step lands the
    // work it produced, so there is nothing between two steps for anyone
    // to weigh, and the next step is simply queued.
    this.o.store.transition(job.id, "step-succeeded", { ...base, stepIndex: nextIndex });
  }
}
