// The queue store itself: one record per job, in
// the shape aide-run-store.ts established — a written-down schema with
// unknown fields ignored, an LRU cap, a mirror written-then-renamed and
// reloaded on boot. No scheduler here: it stores and shows jobs, the
// runner runs them.

import { stepButton } from "../../format/step-label.ts";
import {
  PHASE_STEPS,
  TRANSITIONS,
  UNFINISHED,
  type TransitionEvent,
  type WorkflowStep,
} from "../steps.ts";
import type { CreateProjectAllower, Job, ProjectResolver, QueueDefaults } from "../types.ts";
import type { Sentence } from "../../messages/types.ts";
import { mergeBranchRefs, type BranchRef } from "../types.ts";
import {
  invalidRequest,
  parseCreateRequest,
  parseJobRequest,
  type CreateParseResult,
  type ParseResult,
} from "../parse-request.ts";
import { gerund, landingStepIndex } from "../../format/gerund.ts";
import { specReference } from "../../project/spec-folder.ts";


import { loadJobs, writeJobs } from "./mirror.ts";
import { loadModelIds, recordModelId } from "./model-ids.ts";
import { loadPendingModels, loadPendingSteps, pendingProvidersPath, savePendingTable } from "./pending-tables.ts";
import { editTailModel, renamePendingModel, setPendingModel, writePendingModel, type PickContext } from "./picks.ts";
import { tailEditStep, withTailStep } from "./tail-edits.ts";
import type { PendingModelResult, PendingStepsResult, QueueOptions, TransitionResult } from "./types.ts";
import { ExecutionGroupStore } from "../execution-groups/index.ts";

export class QueueStore {
  readonly executionGroups: ExecutionGroupStore;
  private readonly jobs = new Map<string, Job>(); // insertion order = age order
  private readonly cap: number;
  private readonly mirrorPath?: string;
  private readonly pendingModelsPath?: string;
  private readonly modelIdsPath?: string;
  private readonly pendingStepsPath?: string;
  readonly defaults: QueueDefaults;
  /** A model picked for a phase before any job exists, keyed
   *  by `project/specFolder` and then by step — the same shape
   *  `defaultModels` carries one level shallower. Public and readonly
   *  like `defaults`: the render side reads it straight off, and only
   *  `setPendingModel()` is allowed to write it. */
  readonly pendingModels: Record<string, Record<string, string>> = {};
  /** The provider picked beside each pending model, in the same shape,
   *  kept in a file of its own beside `pending-models.json`. */
  readonly pendingProviders: Record<string, Record<string, string>> = {};
  private readonly pendingProvidersPath?: string;
  /** The phase choice a reader made — at create time, or at a later Run
   *  — recorded so it outlives the one job that made it: the
   *  same `project/specFolder` key as `pendingModels`,
   *  one level shallower (a list of steps, not a per-step value). Only
   *  `setPendingSteps()` is allowed to write it; the render layer reads
   *  it straight off, the way it already reads its two siblings. */
  readonly pendingSteps: Record<string, string[]> = {};
  /** The model id the newest run of each choice reported (`Opus` →
   *  `claude-opus-5-5`); outlives the 200 jobs the queue keeps. */
  readonly modelIds: Record<string, string> = {};
  private readonly resolve: ProjectResolver;
  private readonly allowCreateProject: CreateProjectAllower;
  private readonly onChange: () => void;

  constructor(opts: QueueOptions) {
    this.executionGroups = new ExecutionGroupStore(opts.executionGroupsPath);
    this.cap = opts.cap ?? 1000;
    this.mirrorPath = opts.mirrorPath;
    this.pendingModelsPath = opts.pendingModelsPath;
    this.pendingProvidersPath = pendingProvidersPath(opts.pendingModelsPath);
    this.modelIdsPath = opts.modelIdsPath;
    this.pendingStepsPath = opts.pendingStepsPath;
    this.defaults = opts.defaults;
    this.resolve = opts.resolve;
    this.allowCreateProject = opts.allowCreateProject ?? (() => false);
    this.onChange = opts.onChange ?? (() => {});
    // Before `load()`, which is not a change: nothing is listening yet
    // on the first construction, and a mirror read back at boot is the
    // store finding out what it already was.
    loadJobs(this.mirrorPath, this.jobs);
    while (this.jobs.size > this.cap) this.jobs.delete(this.jobs.keys().next().value as string);
    loadPendingModels(this.pendingModelsPath, this.pendingModels);
    loadPendingModels(this.pendingProvidersPath, this.pendingProviders);
    loadModelIds(this.modelIdsPath, this.modelIds);
    loadPendingSteps(this.pendingStepsPath, this.pendingSteps);
  }

  /** An unfinished job for the same spec that already covers one of
   *  these steps — never what anyone meant, as when one analyze was
   *  posted from the API and from the page seconds apart. */
  private clashing(job: Job): { job: Job; step: WorkflowStep } | null {
    for (const other of this.jobs.values()) {
      if (other.project !== job.project || other.specFolder !== job.specFolder) continue;
      if (!UNFINISHED.has(other.state)) continue;
      const step = job.steps.find((s) => other.steps.includes(s));
      if (step) return { job: other, step };
    }
    return null;
  }

  enqueue(raw: unknown): ParseResult {
    const parsed = parseJobRequest(raw, { resolve: this.resolve, defaults: this.defaults });
    if (!parsed.ok) return parsed;
    return this.insert(parsed);
  }

  /** A spec that does not exist yet. Validated against the raw
   *  allowlist rather than the discovered set — the folder is what the
   *  job is FOR — and stored through the same tail as every other job. */
  enqueueCreate(raw: unknown): ParseResult {
    const parsed: CreateParseResult = parseCreateRequest(raw, {
      allow: this.allowCreateProject,
      resolve: this.resolve,
      defaults: this.defaults,
    });
    if (!parsed.ok) return parsed;
    const result = this.insert(parsed);
    // The New-spec form's own phase table is the first place a
    // reader's choice is made, and it has to survive past this one job
    // — `create` itself is always in `steps` and is never a phase a box
    // could tick, so it is stripped before the choice is recorded. Only
    // on a successful insert: a refused create names no spec for the
    // choice to be filed under. `recordPendingSteps()`, not the public
    // `setPendingSteps()`: `insert()` just above already announced this
    // whole operation once, and calling the public setter here would
    // announce it a second time for one request.
    if (result.ok) {
      this.recordPendingSteps(result.job.project, result.job.specFolder, result.job.steps.filter((s) => s !== "create"));
      // The sibling seed, for a model picked on the New page
      // for a phase this job does not run — `writePendingModel`, not
      // `setPendingModel`, for the same one-announcement-per-request
      // reason as `recordPendingSteps` above.
      for (const [step, model] of Object.entries(parsed.pendingStepModels ?? {})) {
        writePendingModel(this.picks(), result.job.project, result.job.specFolder, step, model, parsed.pendingStepProviders?.[step]);
      }
    }
    return result;
  }

  /** A job for the same spec whose last step is still landing:
   *  `state` already reads "done" the instant a landing starts
   *  (`Runner.complete()` writes both in the same update), so
   *  `UNFINISHED`/`clashing()` — built on `state` alone — never see it.
   *  Unlike `clashing()` this fires regardless of step overlap: a
   *  landing is a merge in progress in the spec's own files, and a
   *  fresh job of ANY step would enqueue behind a half-merged working
   *  tree. */
  private landingJob(job: Job): Job | null {
    for (const other of this.jobs.values()) {
      if (other.project !== job.project || other.specFolder !== job.specFolder) continue;
      if (other.landing) return other;
    }
    return null;
  }

  /** Clash check, insert, cap, mirror — the tail every enqueue shares.
   *  A create job never clashes (its key is unique by construction), but
   *  it goes through the same door for the same reason the cap and the
   *  mirror are not optional. */
  private insert(parsed: { ok: true; job: Job }): ParseResult {
    const clash = this.clashing(parsed.job);
    if (clash) {
      return {
        ok: false,
        error:
          `${clash.step} on ${specReference(parsed.job.project, parsed.job.specFolder)} is already ${clash.job.state} ` +
          `(job ${clash.job.id.slice(0, 8)}) — cancel that one first if you want to start over`,
      };
    }
    const landing = this.landingJob(parsed.job);
    if (landing) {
      // The step actually merging, in the same word the row's own badge
      // shows for it — `landing.steps[landing.stepIndex]`
      // taken raw names the WRONG step once `landing` has already advanced
      // to "queued" on its next one while the previous step's branch is
      // still merging (`gerund.ts`'s `landingStepIndex`, the same rule
      // `landingStep` (`render/ui/job-state/resting.ts`) applies for a
      // `QueueRowView`).
      const lastStep = landing.steps[landingStepIndex(landing.state, landing.stepIndex)] ?? landing.steps[landing.stepIndex]!;
      return {
        ok: false,
        error:
          `${parsed.job.steps[0]} on ${specReference(parsed.job.project, parsed.job.specFolder)} cannot start while ` +
          `${gerund("en", lastStep)} is still in progress ` +
          `(job ${landing.id.slice(0, 8)}) — press ${stepButton(parsed.job.steps[0]!)} again in a moment, once the merge finishes`,
      };
    }
    this.jobs.set(parsed.job.id, parsed.job);
    while (this.jobs.size > this.cap) {
      this.jobs.delete(this.jobs.keys().next().value as string);
    }
    this.mirror();
    this.syncExecutionGroup(parsed.job);
    this.changed();
    return parsed;
  }

  /** One place the three writers announce themselves from, so a fourth
   *  one added later has an obvious thing to call. Fail-open like every
   *  other side channel on this surface: a listener that throws must
   *  not turn a stored job into a refused one. */
  private changed(): void {
    try {
      this.onChange();
    } catch {
      // telling the pages is best effort; the write already happened
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].reverse(); // newest first
  }

  /** Which repos this spec has a branch in right now, across every job
   *  that ever ran for it. The merge route re-derives this itself on
   *  every POST rather than trusting a root the browser sent back —
   *  what the browser gets is labels and URLs, never a path to act on.
   *
   *  The queue's own history is the right source for THIS question —
   *  `aide-run-spec` recorded exactly the repos it pushed, and disk
   *  cannot say it better. It is not the right source for "which steps
   *  has this spec had": that is what the spec's own files say, and
   *  a `stepsCompletedFor` that answered it from job history was
   *  removed for saying otherwise. */
  branchesFor(project: string, specFolder: string): BranchRef[] {
    // Oldest first, so a later job's URL for the same root overwrites an
    // earlier one — `startedAt ?? createdAt` is the same recency signal
    // the render side already sorts specs by.
    const recency = (job: Job) => Date.parse(job.startedAt ?? job.createdAt) || 0;
    const mine = [...this.jobs.values()]
      .filter((j) => j.project === project && j.specFolder === specFolder)
      .sort((a, b) => recency(a) - recency(b));
    let out: BranchRef[] = [];
    for (const job of mine) out = mergeBranchRefs(out, job.branchUrls);
    return out;
  }

  /** What a `pr`-mode run made of this spec's code branch:
   *  the pull request it opened, or why `gh` opened none — off the most
   *  recent job that reported either.
   *
   *  Across the spec's JOBS, not within one, and that is the whole
   *  reason it exists: `implement` pushes the code and opens the
   *  request, `archive` ends the spec and never touches the project
   *  root, so the job a reader is looking at is not the job that knows.
   *
   *  A sibling of `branchesFor` above and recent-first for the same
   *  reason that one is oldest-first: that one FOLDS, so the last write
   *  wins; this one picks, so the first hit has to be the newest. Empty
   *  where no job remembers either — the queue keeps two hundred jobs
   *  and the archive grows past that, so an old spec simply has no link,
   *  which is a blank rather than a claim. */
  pullRequestFor(project: string, specFolder: string): { prUrl?: string } {
    const recency = (job: Job) => Date.parse(job.startedAt ?? job.createdAt) || 0;
    const mine = [...this.jobs.values()]
      .filter((j) => j.project === project && j.specFolder === specFolder)
      .sort((a, b) => recency(b) - recency(a));
    return { prUrl: mine.find((j) => j.prUrl)?.prUrl };
  }

  /** The newest reason a landing for this spec could not delete its own
   *  branch on origin, if any job remembers one. Same shape as
   *  `pullRequestFor`: newest job first, across every job the queue still
   *  holds for `project/specFolder` — a spec whose job the LRU cap has
   *  evicted simply has none, which is a blank, not a claim. */
  branchDeleteErrorFor(project: string, specFolder: string): Sentence | Sentence[] | undefined {
    const recency = (job: Job) => Date.parse(job.startedAt ?? job.createdAt) || 0;
    return [...this.jobs.values()]
      .filter((j) => j.project === project && j.specFolder === specFolder)
      .sort((a, b) => recency(b) - recency(a))
      .find((j) => j.branchDeleteError)?.branchDeleteError;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Every job of one project, gone — the test board's Run control
   *  (self-run.ts) starts its round over from nothing, and rows for
   *  folders the round is about to make again would read as history
   *  the new run never had. Returns how many were dropped. */
  dropProject(project: string): number {
    let dropped = 0;
    for (const [id, job] of this.jobs) {
      if (job.project !== project) continue;
      this.jobs.delete(id);
      dropped += 1;
    }
    if (dropped) {
      this.mirror();
      this.changed();
    }
    return dropped;
  }

  /** Add or remove a step a RUNNING job has not reached yet.
   *
   *  Read, checked and written in ONE synchronous call, with nothing
   *  awaited in between — the same property `insert()` and `update()`
   *  already rely on. That is the whole of what closes the race the
   *  feature is built around: the runner's own `tick()` is synchronous
   *  too, so `stepIndex` cannot move between the check and the write,
   *  and a request that arrives after its step has started finds it
   *  outside `tailEdits()` and is refused by name. A `stepIndex` the
   *  CALLER read a moment ago is never consulted. */
  editTailStep(id: string, step: string, add: boolean): ParseResult {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, ...invalidRequest("no such job") };
    const editable = tailEditStep(job, step);
    if ("error" in editable) return { ok: false, ...editable };
    const wanted = editable.step;
    if (add === job.steps.includes(wanted)) {
      return {
        ok: false,
        ...invalidRequest(add ? `${wanted} is already part of this job` : `${wanted} is not part of this job`),
      };
    }
    const next = { ...job, steps: withTailStep(job, wanted, add) };
    this.jobs.set(id, next);
    this.mirror();
    this.changed();
    return { ok: true, job: next };
  }

  /** Change the model — and the provider — a RUNNING job will use for a
   *  step it has not reached yet; see `picks.ts`. */
  editTailModel(id: string, step: string, model: string, provider?: string): ParseResult {
    return editTailModel(this.picks(), id, step, model, provider);
  }

  /** Record a model, and the provider, picked for a phase that has no job
   *  yet; see `picks.ts`. */
  setPendingModel(project: string, specFolder: string, step: string, model: string, provider?: string): PendingModelResult {
    return setPendingModel(this.picks(), project, specFolder, step, model, provider);
  }

  /** Carries a create job's pending picks from its provisional key to the
   *  real folder landing assigns it. */
  renamePendingModel(project: string, fromFolder: string, toFolder: string): void {
    renamePendingModel(this.picks(), project, fromFolder, toFolder);
  }

  private picks(): PickContext {
    return {
      jobs: this.jobs,
      defaults: this.defaults,
      pendingModels: this.pendingModels,
      pendingProviders: this.pendingProviders,
      persist: () => this.persistPendingModels(),
      mirror: () => this.mirror(),
      changed: () => this.changed(),
    };
  }

  /** The write `setPendingSteps()` and `enqueueCreate()`'s own hook
   *  share, without either one's own `changed()` call: `enqueueCreate()`
   *  folds this into the ONE insert-and-seed operation a create request
   *  is, and `insert()` has already announced that (the
   *  one-fire-per-write rule, pinned by
   *  `test/queue/store/store-core-fields.test.ts` — a second, unwanted
   *  fire here is what a naive `this.setPendingSteps(...)` call inside
   *  `enqueueCreate()` produced before this split). */
  /** A reopen that resets the files discards the round, and the phases a
   *  reader had ticked for it go with it: the row falls back to every
   *  phase the spec has not had, so its button names Analyze. */
  forgetPendingSteps(project: string, specFolder: string): void {
    const key = `${project}/${specFolder}`;
    if (!(key in this.pendingSteps)) return;
    delete this.pendingSteps[key];
    this.persistPendingStepsTable();
    this.changed();
  }

  private recordPendingSteps(project: string, specFolder: string, steps: readonly string[]): void {
    this.pendingSteps[`${project}/${specFolder}`] = steps.filter((s) => (PHASE_STEPS as readonly string[]).includes(s));
    this.persistPendingStepsTable();
  }

  /** Record which phases a reader chose, before or between jobs —
   *  the sibling of `setPendingModel()`/`setPendingEffort()`
   *  above, filtered against `PHASE_STEPS` rather than `WORKFLOW_STEPS`:
   *  `reopen`/`close` and every other internal-only step are real
   *  members of `WORKFLOW_STEPS` but never a phase a row's own checkbox
   *  could have ticked, and must never be recorded as if one had been.
   *  Unlike its two siblings this never refuses — an unknown entry is
   *  dropped rather than reported, the same direction `parsePendingSteps`
   *  already fails in — and the whole list REPLACES what was recorded
   *  before, including down to empty: "nothing ticked" is itself the
   *  choice the form needs to tell apart from "no choice on record at all". */
  setPendingSteps(project: string, specFolder: string, steps: readonly string[]): PendingStepsResult {
    this.recordPendingSteps(project, specFolder, steps);
    this.changed();
    return { ok: true };
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next = { ...job, ...patch };
    this.jobs.set(id, next);
    this.mirror();
    this.syncExecutionGroup(next);
    this.changed();
    return next;
  }

  /** The one way a job's state changes. Looks up
   *  `TRANSITIONS[current][event]`; a hit applies `patch` and the new
   *  state in the same write `update()` already makes atomically, a
   *  miss leaves the job untouched and reports what was refused
   *  `patch` must not itself set `state` — the event is the
   *  only thing allowed to move it. */
  transition(id: string, event: TransitionEvent, patch: Partial<Job> = {}): TransitionResult {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, state: "queued", event }; // unreachable in practice: every caller already holds the job
    const to = TRANSITIONS[job.state]?.[event];
    if (!to) return { ok: false, state: job.state, event };
    const next = { ...job, ...patch, state: to };
    this.jobs.set(id, next);
    this.mirror();
    this.syncExecutionGroup(next);
    this.changed();
    return { ok: true, job: next };
  }

  private mirror(): void {
    writeJobs(this.mirrorPath, this.jobs.values());
  }

  private syncExecutionGroup(job: Job): void {
    if (!job.executionGroupId || !this.executionGroups.get(job.executionGroupId)) return;
    const group = this.executionGroups.get(job.executionGroupId)!;
    const history = {
      id: job.id,
      specFolder: job.specFolder,
      logs: job.results.map((result) => ({ step: result.step, sessionId: result.sessionId, streamFile: result.streamFile })),
    };
    const jobs = [...group.jobs.filter((entry) => entry.id !== job.id), history];
    const state = job.state === "running" ? "running"
      : job.state === "queued" ? "queued"
        : job.state === "stopped" || job.state === "failed" || job.state === "interrupted" ? "stopped"
          : group.state;
    this.executionGroups.update(group.id, { jobs, state, currentMember: job.specFolder });
  }

  /** The newest run of a choice wins; see `model-ids.ts`. */
  recordModelId(choice: string | undefined, modelId: string): void {
    recordModelId(this.modelIdsPath, this.modelIds, choice, modelId);
  }

  private persistPendingModels(): void {
    savePendingTable(this.pendingModelsPath, this.pendingModels);
    savePendingTable(this.pendingProvidersPath, this.pendingProviders);
  }

  private persistPendingStepsTable(): void {
    savePendingTable(this.pendingStepsPath, this.pendingSteps);
  }
}

// What used to live here too, in parts beside this file.
export type { PendingModelResult, PendingStepsResult, TransitionResult, QueueOptions } from "./types.ts";
