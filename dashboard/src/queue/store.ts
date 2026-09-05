// The queue store itself (spec 81, slice 81a): one record per job, in
// the shape aide-run-store.ts established — a written-down schema with
// unknown fields ignored, an LRU cap, a mirror written-then-renamed and
// reloaded on boot. No scheduler here: 81a stores and shows jobs, 81b
// runs them.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  EFFORT_LEVELS,
  TRANSITIONS,
  UNFINISHED,
  WORKFLOW_STEPS,
  tailEdits,
  type TransitionEvent,
  type WorkflowStep,
} from "./steps.ts";
import type { CreateProjectAllower, Job, ProjectResolver, QueueDefaults } from "./types.ts";
import type { Sentence } from "../i18n/message.ts";
import { mergeBranchRefs, type BranchRef } from "./types.ts";
import { NAME_RE, invalidRequest, parseCreateRequest, parseJobRequest, type ParseResult } from "./parse-request.ts";
import { parsePendingEffort, parsePendingModels, parseStoredJob, persistPendingEffort, persistPendingModels } from "./persist.ts";
import { gerund, landingStepIndex } from "../render/ui/job-state/resting.ts";


import type { PendingEffortResult, PendingModelResult, QueueOptions, TransitionResult } from "./store/types.ts";

export class QueueStore {
  private readonly jobs = new Map<string, Job>(); // insertion order = age order
  private readonly cap: number;
  private readonly mirrorPath?: string;
  private readonly pendingModelsPath?: string;
  private readonly pendingEffortPath?: string;
  readonly defaults: QueueDefaults;
  /** A model picked for a phase before any job exists (spec 308), keyed
   *  by `project/specFolder` and then by step — the same shape
   *  `defaultModels` carries one level shallower. Public and readonly
   *  like `defaults`: the render side reads it straight off, and only
   *  `setPendingModel()` is allowed to write it. */
  readonly pendingModels: Record<string, Record<string, string>> = {};
  /** The sibling of `pendingModels`, for an effort level (spec 364).
   *  Only `setPendingEffort()` is allowed to write it. */
  readonly pendingEffort: Record<string, Record<string, string>> = {};
  private readonly resolve: ProjectResolver;
  private readonly allowCreateProject: CreateProjectAllower;
  private readonly onChange: () => void;

  constructor(opts: QueueOptions) {
    this.cap = opts.cap ?? 200;
    this.mirrorPath = opts.mirrorPath;
    this.pendingModelsPath = opts.pendingModelsPath;
    this.pendingEffortPath = opts.pendingEffortPath;
    this.defaults = opts.defaults;
    this.resolve = opts.resolve;
    this.allowCreateProject = opts.allowCreateProject ?? (() => false);
    this.onChange = opts.onChange ?? (() => {});
    // Before `load()`, which is not a change: nothing is listening yet
    // on the first construction, and a mirror read back at boot is the
    // store finding out what it already was.
    this.load();
    this.loadPendingModels();
    this.loadPendingEffort();
  }

  /** An unfinished job for the same spec that already covers one of
   *  these steps. Two of those is never what anyone meant: it happened
   *  when the same analyze was posted from the API and from the page
   *  seconds apart, and the queue took both without a word. */
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

  /** A spec that does not exist yet (spec 93). Validated against the raw
   *  allowlist rather than the discovered set — the folder is what the
   *  job is FOR — and stored through the same tail as every other job. */
  enqueueCreate(raw: unknown): ParseResult {
    const parsed = parseCreateRequest(raw, {
      allow: this.allowCreateProject,
      resolve: this.resolve,
      defaults: this.defaults,
    });
    if (!parsed.ok) return parsed;
    return this.insert(parsed);
  }

  /** A job for the same spec whose last step is still landing (spec
   *  254): `state` already reads "done" the instant a landing starts
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
          `${clash.step} on ${parsed.job.specFolder} is already ${clash.job.state} ` +
          `(job ${clash.job.id.slice(0, 8)}) — cancel that one first if you want to start over`,
      };
    }
    const landing = this.landingJob(parsed.job);
    if (landing) {
      // The step actually merging, in the same word the row's own badge
      // shows for it (spec 399, REQ-3) — `landing.steps[landing.stepIndex]`
      // taken raw names the WRONG step once `landing` has already advanced
      // to "queued" on its next one while the previous step's branch is
      // still merging (`resting.ts`'s `landingStepIndex`, the same rule
      // `landingStep` applies for a `QueueRowView`).
      const lastStep = landing.steps[landingStepIndex(landing.state, landing.stepIndex)] ?? landing.steps[landing.stepIndex]!;
      return {
        ok: false,
        error:
          `${parsed.job.steps[0]} on ${parsed.job.specFolder} cannot start while ` +
          `${gerund("en", lastStep)} is still in progress ` +
          `(job ${landing.id.slice(0, 8)}) — press Run again in a moment, once the merge finishes`,
      };
    }
    this.jobs.set(parsed.job.id, parsed.job);
    while (this.jobs.size > this.cap) {
      this.jobs.delete(this.jobs.keys().next().value as string);
    }
    this.mirror();
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
   *  removed by spec 108 for saying otherwise. */
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

  /** What a `pr`-mode run made of this spec's code branch (spec 220):
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
  pullRequestFor(project: string, specFolder: string): { prUrl?: string; prError?: string } {
    const recency = (job: Job) => Date.parse(job.startedAt ?? job.createdAt) || 0;
    const mine = [...this.jobs.values()]
      .filter((j) => j.project === project && j.specFolder === specFolder)
      .sort((a, b) => recency(b) - recency(a));
    return {
      prUrl: mine.find((j) => j.prUrl)?.prUrl,
      prError: mine.find((j) => j.prError)?.prError,
    };
  }

  /** The newest reason a landing for this spec could not delete its own
   *  branch on origin, if any job remembers one (spec 319). Same shape as
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

  /** Add or remove a step a RUNNING job has not reached yet (spec 160).
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
    if (!job) return { ok: false, error: invalidRequest("no such job") };
    const named = step || "that step";
    const wanted = WORKFLOW_STEPS.find((s) => s === step);
    if (!wanted || !tailEdits(job).includes(wanted)) {
      // One sentence, and it names the step: the row has a single line
      // to say why a tick did not take.
      return {
        ok: false,
        error: invalidRequest(
          job.state === "running"
            ? `${named} is not a step this run can still be given`
            : `${named} cannot be changed: this job is ${job.state}, not running`,
        ),
      };
    }
    const present = job.steps.includes(wanted);
    if (add === present) {
      return {
        ok: false,
        error: invalidRequest(add ? `${named} is already part of this job` : `${named} is not part of this job`),
      };
    }
    const head = job.steps.slice(0, job.stepIndex + 1);
    const tail = job.steps.slice(job.stepIndex + 1);
    if (add) {
      // Into the TAIL at its own rank, never at the array's end: a job
      // running analyze that is given archive and then implement must
      // run implement first.
      const rank = WORKFLOW_STEPS.indexOf(wanted);
      const before = tail.findIndex((s) => WORKFLOW_STEPS.indexOf(s) > rank);
      tail.splice(before === -1 ? tail.length : before, 0, wanted);
    } else {
      tail.splice(tail.indexOf(wanted), 1);
    }
    const next = { ...job, steps: [...head, ...tail] };
    this.jobs.set(id, next);
    this.mirror();
    this.changed();
    return { ok: true, job: next };
  }

  /** Change the model a RUNNING job will use for a step it has not
   *  reached yet (spec 225) — the AI and model selects beside the
   *  boxes spec 160 unlocked.
   *
   *  Guarded by the SAME `tailEdits()` the box's own route asks, so a
   *  select drawn live and the store that takes its pick can never
   *  disagree about where the tail starts. It answers for both kinds
   *  of step that function names without a branch between them: one
   *  already in the job's tail, and one the job does not have at all —
   *  `Job.model` is a per-step table, and an entry for a step nobody
   *  has ticked is inert until the step is added and reached.
   *
   *  Read, checked and written in ONE synchronous call, nothing awaited
   *  in between, exactly as `editTailStep` above: that is what makes a
   *  pick arriving after its step has started find it outside
   *  `tailEdits()` and be refused by name, rather than land too late
   *  and silently.
   *
   *  The name is checked against the SAME table `parseJobRequest` reads
   *  at job creation, in the same words — a small duplication, chosen
   *  over extracting a shared helper out of a working, tested path
   *  nothing here asked to change. What it does NOT do is re-grant a
   *  budget: the caps are the config's to give at job creation, and a
   *  job started on a modest model does not buy a hungrier one's
   *  headroom by being re-pointed at it mid-run. */
  editTailModel(id: string, step: string, model: string): ParseResult {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, error: invalidRequest("no such job") };
    const named = step || "that step";
    const wanted = WORKFLOW_STEPS.find((s) => s === step);
    if (!wanted || !tailEdits(job).includes(wanted)) {
      // One sentence, and it names the step — the row has a single line
      // to say why a pick did not take.
      return {
        ok: false,
        error: invalidRequest(
          job.state === "running"
            ? `${named} is not a step this run can still be given`
            : `${named} cannot be changed: this job is ${job.state}, not running`,
        ),
      };
    }
    if (!NAME_RE.test(model)) return { ok: false, error: invalidRequest("invalid model") };
    const found = this.defaults.modelChoices?.[model];
    if (!found) {
      return {
        ok: false,
        error: invalidRequest(
          this.defaults.modelChoices
            ? `unknown or not-allowed model: ${model}`
            : "no model choice is configured on this server",
        ),
      };
    }
    const next = { ...job, model: { ...job.model, [wanted]: model } };
    this.jobs.set(id, next);
    this.mirror();
    this.changed();
    return { ok: true, job: next };
  }

  /** Record a model picked for a phase that has no job yet (spec 308) —
   *  the pre-job sibling of `editTailModel()` above, and checked the
   *  same way: the step against `WORKFLOW_STEPS`, the model against the
   *  configured allowlist. There is no `job.state` to gate on, since
   *  there is no job at all; the ONLY question is whether the step and
   *  the model are real. */
  setPendingModel(project: string, specFolder: string, step: string, model: string): PendingModelResult {
    const wanted = WORKFLOW_STEPS.find((s) => s === step);
    if (!wanted) return { ok: false, error: invalidRequest(`${step || "that step"} is not a step a model can be chosen for`) };
    if (!NAME_RE.test(model)) return { ok: false, error: invalidRequest("invalid model") };
    const found = this.defaults.modelChoices?.[model];
    if (!found) {
      return {
        ok: false,
        error: invalidRequest(
          this.defaults.modelChoices
            ? `unknown or not-allowed model: ${model}`
            : "no model choice is configured on this server",
        ),
      };
    }
    const key = `${project}/${specFolder}`;
    this.pendingModels[key] = { ...this.pendingModels[key], [wanted]: model };
    this.persistPendingModels();
    this.changed();
    return { ok: true };
  }

  /** The sibling of `setPendingModel()`, for an effort level (spec 364).
   *  Checked against `WORKFLOW_STEPS` and `EFFORT_LEVELS` directly —
   *  there is no config table to look a grant up in, since effort
   *  levels carry no budget of their own (2-analysis.md, "Config-vs-
   *  code precedence tables are for THINGS THAT COST MONEY"). */
  setPendingEffort(project: string, specFolder: string, step: string, effort: string): PendingEffortResult {
    const wanted = WORKFLOW_STEPS.find((s) => s === step);
    if (!wanted) return { ok: false, error: invalidRequest(`${step || "that step"} is not a step an effort level can be chosen for`) };
    if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
      return { ok: false, error: invalidRequest(`invalid effort: ${effort} (one of: ${EFFORT_LEVELS.join(", ")})`) };
    }
    const key = `${project}/${specFolder}`;
    this.pendingEffort[key] = { ...this.pendingEffort[key], [wanted]: effort };
    this.persistPendingEffortTable();
    this.changed();
    return { ok: true };
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next = { ...job, ...patch };
    this.jobs.set(id, next);
    this.mirror();
    this.changed();
    return next;
  }

  /** The one way a job's state changes (spec 354, REQ-2). Looks up
   *  `TRANSITIONS[current][event]`; a hit applies `patch` and the new
   *  state in the same write `update()` already makes atomically, a
   *  miss leaves the job untouched and reports what was refused
   *  (REQ-3). `patch` must not itself set `state` — the event is the
   *  only thing allowed to move it. */
  transition(id: string, event: TransitionEvent, patch: Partial<Job> = {}): TransitionResult {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, state: "queued", event }; // unreachable in practice: every caller already holds the job
    const to = TRANSITIONS[job.state]?.[event];
    if (!to) return { ok: false, state: job.state, event };
    const next = { ...job, ...patch, state: to };
    this.jobs.set(id, next);
    this.mirror();
    this.changed();
    return { ok: true, job: next };
  }

  private load(): void {
    if (!this.mirrorPath || !existsSync(this.mirrorPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.mirrorPath, "utf-8")) as unknown;
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        const job = parseStoredJob(entry);
        if (job) this.jobs.set(job.id, job);
      }
    } catch {
      // a corrupt mirror is not worth crashing over — start empty
    }
  }

  private mirror(): void {
    if (!this.mirrorPath) return;
    try {
      mkdirSync(dirname(this.mirrorPath), { recursive: true });
      const tmp = `${this.mirrorPath}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.jobs.values()], null, 2));
      renameSync(tmp, this.mirrorPath);
    } catch {
      // mirroring is best effort
    }
  }

  private loadPendingModels(): void {
    if (!this.pendingModelsPath || !existsSync(this.pendingModelsPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.pendingModelsPath, "utf-8")) as unknown;
      const parsed = parsePendingModels(raw);
      if (parsed) Object.assign(this.pendingModels, parsed);
    } catch {
      // a corrupt file is not worth crashing over — start empty
    }
  }

  private persistPendingModels(): void {
    if (!this.pendingModelsPath) return;
    persistPendingModels(this.pendingModelsPath, this.pendingModels);
  }

  private loadPendingEffort(): void {
    if (!this.pendingEffortPath || !existsSync(this.pendingEffortPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.pendingEffortPath, "utf-8")) as unknown;
      const parsed = parsePendingEffort(raw);
      if (parsed) Object.assign(this.pendingEffort, parsed);
    } catch {
      // a corrupt file is not worth crashing over — start empty
    }
  }

  private persistPendingEffortTable(): void {
    if (!this.pendingEffortPath) return;
    persistPendingEffort(this.pendingEffortPath, this.pendingEffort);
  }
}

// What used to live here too, in parts beside this file.
export type { PendingModelResult, PendingEffortResult, TransitionResult, QueueOptions } from "./store/types.ts";
