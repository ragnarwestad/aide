// The queue store (spec 81, slice 81a): one record per job, in the
// shape aide-run-store.ts established — a written-down schema with
// unknown fields ignored, an LRU cap, a mirror written-then-renamed and
// reloaded on boot. No scheduler here: 81a stores and shows jobs, 81b
// runs them.
//
// Two properties are security, not tidiness:
//   * a request carries NAMES, never paths — the server resolves the
//     project itself against the discovered, allowlisted set
//   * a request may only TIGHTEN a cap, and cannot set the permission
//     mode at all; widening what an unattended run may do is not
//     something an HTTP body gets to decide

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";

// `core/scripts/aide-run-spec` keeps the same list in a bash string with
// no shared source between them; a python test (`test_aide_run_spec.py`)
// compares the two.
//
// `resolve` was here until spec 171 and is deliberately gone: a merge
// that fails is the merging step's problem, so `archive` resolves the
// conflict itself rather than a sixth phase standing beside the five.
//
// `reopen` joined it in spec 198: an archived spec whose work has to be
// done again is taken back into the active list by a step like any
// other, so that the dashboard's control and `/aide-reopen` in a
// terminal are one operation with one path. Queueable, but deliberately
// NOT part of the workflow arc (`HISTORY_STEPS`, `parse-status.ts`'s own
// list, the bash `WORKFLOW_ARC`) — it is not a stage a spec passes
// through and it draws no phase box, exactly as `explore` and `manifest`
// do not.
export const WORKFLOW_STEPS = [
  "explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset",
] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

/** Keep only jobs after the newest Reset that completed and landed. */
export function currentWorkRoundJobs<T extends {
  steps: readonly string[];
  state: string;
  landing?: boolean;
  createdAt: string;
  startedAt?: string;
}>(
  jobs: T[],
): T[] {
  const at = (job: T): number => Date.parse(job.startedAt ?? job.createdAt) || 0;
  const boundary = jobs
    .filter((job) => job.state === "done" && !job.landing && job.steps.includes("reset"))
    .reduce((latest, job) => Math.max(latest, at(job)), -Infinity);
  return boundary === -Infinity ? jobs : jobs.filter((job) => at(job) > boundary);
}

/** The steps a spec's row draws a box for, in the order they run — and
 *  so the steps a running job's tail may be given (spec 160). It is
 *  narrower than `WORKFLOW_STEPS` on purpose: `create` cannot be run
 *  for a spec that exists, `explore` is not a phase of the work, and
 *  `manifest` is not part of the workflow's order at all.
 *
 *  `queue-list.ts` keeps the same list, because the render layer does
 *  not import this module; the two are hand-paired and compared by
 *  `queue.test.ts`, exactly as `WORKFLOW_STEPS` is compared with the
 *  bash copy in `aide-run-spec`. */
export const PHASE_STEPS = ["analyze", "implement", "archive"] as const;

/** Which steps a reader may still tick or untick on a job, in workflow
 *  order — the tail that has not started, plus every phase the job does
 *  not have that would run AFTER the one running now.
 *
 *  One function for two callers: the store refuses anything it does not
 *  name, and `serve.ts` puts it on the row so a box is never drawn live
 *  for an edit the store would refuse. Nothing but a RUNNING job has an
 *  editable tail — a job between two steps is a job whose next step may
 *  start in the same instant, and the window is under two seconds. */
export function tailEdits(job: Pick<Job, "steps" | "stepIndex" | "state">): string[] {
  if (job.state !== "running") return [];
  const current = job.steps[job.stepIndex];
  if (current === undefined) return [];
  const rank = WORKFLOW_STEPS.indexOf(current as WorkflowStep);
  const tail = new Set(job.steps.slice(job.stepIndex + 1));
  return PHASE_STEPS.filter(
    (s) => tail.has(s) || (!job.steps.includes(s) && WORKFLOW_STEPS.indexOf(s) > rank),
  );
}

export const JOB_STATES = [
  "queued", "running", "done",
  "stopped", "failed", "cancelled", "interrupted",
] as const;
export type JobState = (typeof JOB_STATES)[number];

// Why a run ended early. `stopped` is deliberately not `failed`: with
// tight caps a cap-stop is a common, healthy outcome, and a reader who
// cannot tell it from a broken agent will start ignoring both.
export type StopReason = "budget" | "timeout" | "provider-limit" | "job-cap";

/** States where a job still owns its work. Anything else has released
 *  it, and the same step may be queued again.
 *
 *  `awaiting-approval` was the third of them until spec 149. It was a
 *  stop between steps, waiting for a person to press Approve — and
 *  since every step lands its own work now, there is nothing left to
 *  hold a job for. */
const UNFINISHED = new Set<string>(["queued", "running"]);

/** What one step actually metered, as `aide-run-spec` read it out of
 *  claude's own result event (spec 118). `total` is the sum of the other
 *  four: cached or not, every one of those tokens was processed, and
 *  that is what a subscription plan bills against.
 *
 *  The split is stored even though only the total is displayed today —
 *  reading it back out of the result file later is not an option, since
 *  the file is gone with the run. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

export interface StepResult {
  step: WorkflowStep;
  ok: boolean;
  costUsd: number;
  /** Which CLI ran this step (spec 125). Absent on every result written
   *  before the second tool existed, which is why the readers all treat
   *  absent as claude rather than as unknown. */
  tool?: "claude" | "codex";
  /** Absent when the run could not measure it — an old result file, or
   *  a killed step, whose cost is over-charged by rule but whose token
   *  count has nothing to assume from. The page shows a dash. */
  tokens?: TokenUsage;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  /** Where this step's claude transcript was kept, when one was. Recorded
   *  per step, so a finished step stays readable after the next one has
   *  overwritten the job's live pointers. */
  streamFile?: string;
  at: string;
}

/** One repo a step pushed the spec's branch to, and the compare page for
 *  it. `aide-run-spec` emits one of these per repo it actually changed —
 *  a job that touches two repositories makes a branch of the same name in
 *  both, with different contents and two separate compare pages. */
export interface BranchRef {
  root: string;
  url: string;
}

/** Fold `next` into `prev` BY ROOT. A step that touched fewer repos than
 *  an earlier one must not erase the others: analyze changes only the
 *  specs repo, implement changes both, and a wholesale replace would make
 *  the project's branch disappear from a spec that has one. */
export function mergeBranchRefs(prev: BranchRef[] | undefined, next: BranchRef[] | undefined): BranchRef[] {
  const out = [...(prev ?? [])];
  for (const ref of next ?? []) {
    if (!ref || typeof ref.root !== "string" || typeof ref.url !== "string") continue;
    const at = out.findIndex((r) => r.root === ref.root);
    if (at >= 0) out[at] = ref;
    else out.push(ref);
  }
  return out;
}

export interface Job {
  id: string;
  project: string;
  specFolder: string;
  steps: WorkflowStep[];
  stepIndex: number;
  state: JobState;
  budgetUsd: number;
  jobCapUsd: number;
  /** Per step, resolved at creation like `permissionMode`/`model` (spec
   *  152). A job persisted before that change still holds a bare
   *  number; `resolveTimeoutSec` in serve.ts is what reads either. */
  timeoutSec: Record<string, number>;
  permissionMode: Record<string, string>;
  model: Record<string, string>;
  /** The model picked for this whole job, when one was picked. Absent
   *  means the per-step configuration decided. */
  modelChoice?: string;
  /** What a `create` job is FOR: the spec it is about to make. Both are
   *  handed to `aide-run-spec` as `--title`/`--description`, and only a
   *  create job has them — every other job names a spec that already
   *  exists. The title also labels the job's row while its `specFolder`
   *  is still the provisional key. */
  createTitle?: string;
  createDescription?: string;
  /** Specs this one builds on, named by folder — the create form's
   *  equivalent of the `Depends on:` line spec 92 gave a reader and no
   *  writer but a person at a shell. Validated against the SAME
   *  project's active specs; absent means no line at all. */
  createDependsOn?: string[];
  /** Set while a finished step's work is being landed on a default
   *  branch — a merge that runs AFTER the step reported success, in this
   *  process, against a shared main checkout no worktree isolates. The
   *  scheduler starts nothing at all while it is true; see
   *  `Runner.tick()`. Never restored from the mirror: a flag belongs to
   *  a call in flight, and one that survived a restart would hold the
   *  whole queue shut with nothing left to clear it. */
  landing?: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  pgid?: number;
  resultFile?: string;
  /** The session of the step running RIGHT NOW, generated before the
   *  spawn rather than read out of the result afterwards. Cleared the
   *  moment the step ends: a finished job that still advertises a live
   *  session is a lie the page would render as "running somewhere". */
  sessionId?: string;
  /** Where that step's transcript is being written, alongside
   *  `resultFile` and from the same source of truth. */
  streamFile?: string;
  results: StepResult[];
  spentUsd: number;
  /** The same sum over the steps that REPORTED tokens, absent while none
   *  has. Not zero: a job whose steps all predate spec 118 has no token
   *  figure, and a zero would say it used none. */
  spentTokens?: number;
  /** Where the work can be read: the compare page for the spec's
   *  branch, or the pull request when the push mode opened one. ONE
   *  link, kept because a Slack ping wants exactly one — see
   *  `branchUrls` for the answer to "which repos". */
  branchUrl?: string;
  /** Every repo this job's steps pushed to, accumulated by root. Absent
   *  on a job written before spec 89; the page falls back to
   *  `branchUrl` for those, which is the behaviour they already had. */
  branchUrls?: BranchRef[];
  /** The pull request a `pr`-mode run opened for this job's code branch
   *  (spec 220). Accumulated across steps like `branchUrl`: `implement`
   *  pushes the code and opens the request, `archive` ends the job and
   *  never touches the project root, so the two are not the same step.
   *  Absent for every job on a project that merges its code, which is
   *  every job there was before this spec. */
  prUrl?: string;
  /** Why `gh` opened none. Not an `error`: the step succeeded and the
   *  code is on its branch — what is missing is the request describing
   *  it, which for a project whose landing deliberately leaves that
   *  branch open is exactly the thing a reader has to be told. */
  prError?: string;
  stopReason?: StopReason;
  error?: string;
  /** The one machine-readable class of refusal: a merge that failed on a
   *  real conflict. Stored on the job since spec 149, and stored rather
   *  than passed because a landing happens with nobody's browser
   *  attached — the one-shot redirect the Merge button used to carry it
   *  in has no equivalent here. Cleared, like `error`, the moment a
   *  landing succeeds.
   *
   *  It stopped being a thing the ROW acts on in spec 171. `archive`
   *  resolves a conflict with the default branch itself, so a conflict
   *  that survives to a reader is one no machine could settle: the row
   *  shows it as the failure's own text, beside the ordinary re-run
   *  control every other failed step already offers.
   *
   *  `"unlanded"` is spec 193's: the archive step succeeded and a
   *  branch of the spec's own is still on origin. It is the CLASS the
   *  refusal carries beside the sentence a person reads — the sentence
   *  is joined across repos before any page sees it, so nothing may
   *  match on it. Paired by hand with the same union in
   *  `render/job-state.ts`, which does not import this module; the two
   *  are read side by side by `queue.test.ts`. */
  errorReason?: "conflict" | "unlanded";
}

/** What one pickable model is granted. The budget lives HERE, not in
 *  the request: a hungrier model needs more headroom per step, and the
 *  only place allowed to grant headroom is the config file on the
 *  machine that runs the jobs. */
export interface ModelChoice {
  budgetUsd: number;
  jobCapUsd?: number;
  /** Which CLI runs a step picked on this entry (spec 125). Absent
   *  means claude — every config written before the second tool existed
   *  keeps meaning exactly what it meant. */
  tool?: "claude" | "codex";
  /** The literal `--model` value, when it differs from this entry's own
   *  key. The key is what the picker shows and what a request posts;
   *  this is what the CLI is actually handed, so a readable name like
   *  `codex-fast` can front a model string nobody wants to read. */
  model?: string;
}

export interface QueueDefaults {
  budgetUsd: number;
  jobCapUsd: number;
  dailyCapUsd: number;
  /** Per step, with a `default` fallback — the same shape as
   *  `permissionMode`/`model`, because an implement is not an analyze
   *  and one number for both stopped spec 149 mid-sentence with its
   *  tests already green. Config-only — see the header. */
  timeoutSec: Record<string, number>;
  /** Per step, with a `default` fallback. Config-only — see the header. */
  permissionMode: Record<string, string>;
  model: Record<string, string>;
  /** Which models a job may be asked to run on, and what each is
   *  granted. Absent means no choice is offered and naming one is
   *  refused — off by default, like the rest of the queue. */
  modelChoices?: Record<string, ModelChoice>;
}

/** Resolves a project NAME to its real spec folders, or null if it is
 *  not both discovered and allowlisted. */
export type ProjectResolver = (project: string) => {
  specFolders: string[];
  /** The project's ARCHIVED spec folders (spec 198), which one step and
   *  no other may be asked for: `reopen`, the step that exists to take
   *  a spec back out of the archive.
   *
   *  Kept apart from `specFolders` rather than merged into it, because
   *  merging would widen every OTHER step to archived specs too — and
   *  spec 193 already relies on an archived spec being refused unless
   *  its branch is still open. That exception lives in `specFolders`,
   *  where it belongs; this one is per step. */
  archivedFolders?: string[];
} | null;

/** The one step an archived spec may be asked for (spec 198). A literal
 *  step name and never a denylist of the others: a list to be kept in
 *  step with `WORKFLOW_STEPS` is the drift this repo already names
 *  three times over. */
const ARCHIVE_ONLY_STEP = "reopen";

export type ParseResult = { ok: true; job: Job } | { ok: false; error: string };

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const FOLDER_RE = /^[A-Za-z0-9._-]{1,128}$/;

function perStep<T>(steps: WorkflowStep[], table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of steps) out[s] = table[s] ?? table.default;
  return out;
}

// A cap override is accepted only when it is stricter than the config.
function tighten(raw: unknown, limit: number, name: string): number | Error {
  if (raw === undefined || raw === null) return limit;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return new Error(`invalid ${name}`);
  if (raw > limit) return new Error(`${name} may only be tightened (max ${limit})`);
  return raw;
}

/** The one table a posted model NAME is checked against (spec 228).
 *
 *  It was `parseJobRequest`'s own closure until the New-spec form gained
 *  a Model choice of its own: two parsers now read a name off a request,
 *  and the sentence a refusal carries is the same sentence in both — a
 *  second copy would have drifted the first time one was reworded.
 *
 *  Two different answers, deliberately: a name that is merely not on the
 *  list, and a server that offers no list at all. Everything the choice
 *  is GRANTED comes from here; the request supplies only the name. */
function lookUpModel(defaults: QueueDefaults, name: string): ModelChoice | { error: string } {
  const found = defaults.modelChoices?.[name];
  if (found) return found;
  return {
    error: defaults.modelChoices
      ? `unknown or not-allowed model: ${name}`
      : "no model choice is configured on this server",
  };
}

export function parseJobRequest(
  raw: unknown,
  opts: { resolve: ProjectResolver; defaults: QueueDefaults },
): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body is not an object" };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, error: "invalid project" };
  const resolved = opts.resolve(r.project);
  if (!resolved) return { ok: false, error: `unknown or not-allowed project: ${r.project}` };

  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) {
    return { ok: false, error: "invalid specFolder" };
  }
  const archivedOnly =
    !resolved.specFolders.includes(r.specFolder) &&
    (resolved.archivedFolders ?? []).includes(r.specFolder);
  if (!resolved.specFolders.includes(r.specFolder) && !archivedOnly) {
    return { ok: false, error: `unknown specFolder: ${r.specFolder}` };
  }

  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 8) {
    return { ok: false, error: "steps must be a list of 1-8 workflow steps" };
  }
  const steps: WorkflowStep[] = [];
  for (const s of r.steps) {
    if (typeof s !== "string" || !(WORKFLOW_STEPS as readonly string[]).includes(s)) {
      return { ok: false, error: `invalid entry in steps: ${String(s)}` };
    }
    steps.push(s as WorkflowStep);
  }

  // Checked here rather than beside the folder lookup above, so that the
  // errors keep the order they have always had: a request with a folder
  // nobody knows still hears about the folder first. An archived spec is
  // admitted for `reopen` alone (spec 198) — every other step is refused
  // by name here, and `aide-run-spec`'s own `--spec` gate refuses it a
  // second time for a run started by hand.
  if (archivedOnly && steps.some((s) => s !== ARCHIVE_ONLY_STEP)) {
    return {
      ok: false,
      error: `${r.specFolder} is archived — only ${ARCHIVE_ONLY_STEP} can be asked for it`,
    };
  }

  // `gateAfter` was parsed here until spec 149 — a list of steps to stop
  // after. It is an unknown key now, and unknown keys are ignored rather
  // than refused (see the header): the three jobs that ever carried one
  // were posted as JSON by hand, and refusing the field would turn a
  // retired feature into a new error.

  // `extraProjects` was parsed here — passenger repos a run would also
  // branch, commit and push, named on the row by a tick box per project.
  // The box went when 0 of the queue's 200 jobs turned out to have used
  // one, and the field went with it. Like `gateAfter` above it is an
  // unknown key now, ignored rather than refused, so the jobs that
  // carry one still load.

  // A model may be picked for the whole job — that is how the heaviest
  // model is reserved for the heaviest work — or once per STEP, which
  // is what the phase lines post since spec 123. The NAME comes from
  // the request either way; everything it is granted comes from the
  // config, looked up in exactly the same table.
  let modelChoice: string | undefined;
  let choice: ModelChoice | undefined;
  let stepModels: Record<string, string> | undefined;
  if (typeof r.model === "string" && r.model !== "") {
    if (!NAME_RE.test(r.model)) return { ok: false, error: "invalid model" };
    const found = lookUpModel(defaults, r.model);
    if ("error" in found) return { ok: false, error: found.error };
    choice = found;
    modelChoice = r.model;
  } else if (r.model !== undefined && r.model !== null && r.model !== "") {
    // The per-step shape. An empty string keeps meaning "use the
    // configuration" — the branch above lets it fall through here, and
    // this guard has to let it fall through again rather than call it a
    // malformed object.
    if (typeof r.model !== "object" || Array.isArray(r.model)) return { ok: false, error: "invalid model" };
    stepModels = {};
    const grants: ModelChoice[] = [];
    for (const [step, name] of Object.entries(r.model as Record<string, unknown>)) {
      // A phase left on "default" posts nothing to apply. Skipped, not
      // refused: the config's own per-step choice is the answer.
      if (name === undefined || name === null || name === "") continue;
      // Skipped, not refused: since the phase lines' selects are always
      // pre-filled (2026-08-19), every Run posts a name for all five
      // steps, whichever are ticked. Only the ticked ones apply.
      if (!steps.includes(step as WorkflowStep)) continue;
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, error: `invalid model for ${step}` };
      const found = lookUpModel(defaults, name);
      if ("error" in found) return { ok: false, error: found.error };
      stepModels[step] = name;
      grants.push(found);
    }
    // Two picks together may not buy more headroom than the more
    // generous of them already had on its own: the file's rule is that
    // a request may only TIGHTEN a cap, so the ceiling is the LARGEST
    // single grant, never the sum.
    if (grants.length) {
      choice = {
        budgetUsd: Math.max(...grants.map((c) => c.budgetUsd)),
        jobCapUsd: grants.some((c) => c.jobCapUsd !== undefined)
          ? Math.max(...grants.map((c) => c.jobCapUsd ?? c.budgetUsd))
          : undefined,
      };
    }
  }

  const budgetUsd = tighten(r.budgetUsd, choice?.budgetUsd ?? defaults.budgetUsd, "budgetUsd");
  if (budgetUsd instanceof Error) return { ok: false, error: budgetUsd.message };
  const jobCapUsd = tighten(r.jobCapUsd, choice?.jobCapUsd ?? defaults.jobCapUsd, "jobCapUsd");
  if (jobCapUsd instanceof Error) return { ok: false, error: jobCapUsd.message };
  // Per step, each against its OWN ceiling: an override that would be a
  // tightening for implement can be a loosening for analyze, and the
  // job holding both may not buy the one by naming the other.
  const timeoutLimits = perStep(steps, defaults.timeoutSec);
  const timeoutSec: Record<string, number> = {};
  for (const s of steps) {
    const t = tighten(r.timeoutSec, timeoutLimits[s]!, "timeoutSec");
    if (t instanceof Error) return { ok: false, error: t.message };
    timeoutSec[s] = t;
  }

  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      project: r.project,
      specFolder: r.specFolder,
      steps,
      stepIndex: 0,
      state: "queued",
      budgetUsd,
      jobCapUsd,
      timeoutSec,
      permissionMode: perStep(steps, defaults.permissionMode),
      // A whole-job pick applies to EVERY step: "reserve the heavy
      // model for the heavy job" is a decision about the job. A
      // per-step map overrides only the steps it names, and every
      // other step keeps the config's own choice.
      model: modelChoice
        ? Object.fromEntries(steps.map((s) => [s, modelChoice]))
        : { ...perStep(steps, defaults.model), ...stepModels },
      // Left unset for a per-step map: it means "one model for the
      // whole job", which is no longer true once the steps may differ.
      modelChoice,
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
  };
}

// --- a spec that does not exist yet (spec 93) -------------------------------

/** Whether this project may have a spec CREATED in it. The raw
 *  allowlist, deliberately — not `ProjectResolver`, which answers "not
 *  found" for a project with no spec on disk yet. That gap is exactly
 *  what makes a project's first spec uncreatable, and widening the
 *  resolver itself would widen every other route with it. */
export type CreateProjectAllower = (project: string) => boolean;

/** How long the two free-text fields may be. Bounded for the same reason
 *  every other field here is: they end up as arguments to an unattended
 *  run, and a prompt is not the place to discover that somebody pasted a
 *  document into a title. */
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;

/** Anything a terminal, an argv or a prompt would read as structure. A
 *  newline is allowed in the description and nowhere else: a description
 *  is a paragraph, a title is a line. */
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/;

function text(raw: unknown, max: number, name: string, multiline = false): string | Error {
  if (typeof raw !== "string") return new Error(`invalid ${name}`);
  const value = raw.replace(/\r\n?/g, "\n").trim();
  if (!value) return new Error(`${name} is required`);
  if (value.length > max) return new Error(`${name} is too long (max ${max})`);
  if (CONTROL_CHARS.test(value)) return new Error(`${name} contains control characters`);
  if (!multiline && value.includes("\n")) return new Error(`${name} must be one line`);
  return value;
}

/** The provisional key a create job carries in place of a spec folder,
 *  until `/aide-create` decides the real name. Obviously not a spec
 *  folder, on purpose: nothing in this codebase may compute a spec's
 *  number or slug except the skill whose own steps 2 and 3 own that rule
 *  (spec 82's mistake was one rule written down twice). */
const provisionalKey = (): string =>
  `new-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

export function parseCreateRequest(
  raw: unknown,
  opts: { allow: CreateProjectAllower; resolve?: ProjectResolver; defaults: QueueDefaults },
): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body is not an object" };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, error: "invalid project" };
  if (!opts.allow(r.project)) return { ok: false, error: `unknown or not-allowed project: ${r.project}` };

  const title = text(r.title, TITLE_MAX, "title");
  if (title instanceof Error) return { ok: false, error: title.message };
  const description = text(r.description, DESCRIPTION_MAX, "description", true);
  if (description instanceof Error) return { ok: false, error: description.message };

  // What the new spec builds on (spec 110). Scoped to the SAME project a
  // dependency guard would later check it against — `aide-run-spec`
  // resolves every "Depends on:" entry inside its own $specs_root — and
  // read off the server's own resolver, never off whichever chips the
  // browser happened to render. Refused entry by entry, like every other
  // list-shaped field here; nothing is silently dropped.
  const dependsOn: string[] = [];
  if (r.dependsOn !== undefined && r.dependsOn !== null) {
    if (!Array.isArray(r.dependsOn)) return { ok: false, error: "dependsOn must be a list" };
    if (r.dependsOn.length > 20) return { ok: false, error: "dependsOn: at most 20" };
    // No resolver, no known specs: a caller that never looks anything up
    // cannot name a dependency, which is the right answer for a call
    // site that does not carry the field at all.
    const known = new Set(opts.resolve?.(r.project)?.specFolders ?? []);
    for (const d of r.dependsOn) {
      if (typeof d !== "string" || !FOLDER_RE.test(d) || !known.has(d)) {
        return { ok: false, error: `unknown spec in dependsOn: ${String(d)}` };
      }
      if (dependsOn.includes(d)) return { ok: false, error: `dependsOn repeats ${d}` };
      dependsOn.push(d);
    }
  }

  // Which model the one step this job runs is run ON (spec 228). Every
  // step BUT `create` could already be pointed at one from its own
  // phase line; `create` MAKES the spec those lines belong to, so there
  // is no row to pick it from and the New-spec form is where the choice
  // is made instead.
  //
  // The per-step shape, which is what `bodyToObject` already folds a
  // posted `model.create=` into — the same shape, and the same table
  // (`lookUpModel`), as every phase line's pick, so a name accepted here
  // is a name `parseJobRequest` would accept too. An empty value keeps
  // meaning "the configuration decides": that is what an untouched
  // select posts, and what a form with no Model field at all leaves out.
  let modelChoice: string | undefined;
  if (r.model !== undefined && r.model !== null && r.model !== "") {
    if (typeof r.model !== "object" || Array.isArray(r.model)) return { ok: false, error: "invalid model" };
    // The one step this job runs, and no other. A name posted for a
    // step a create job does not have is skipped rather than refused —
    // the rule `parseJobRequest` already follows for the same reason: a
    // browser posts every select it drew, whichever are ticked.
    const name = (r.model as Record<string, unknown>).create;
    if (name !== undefined && name !== null && name !== "") {
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, error: "invalid model for create" };
      const found = lookUpModel(defaults, name);
      if ("error" in found) return { ok: false, error: found.error };
      modelChoice = name;
    }
  }

  const steps: WorkflowStep[] = ["create"];
  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      project: r.project,
      specFolder: provisionalKey(),
      steps,
      stepIndex: 0,
      state: "queued",
      budgetUsd: defaults.budgetUsd,
      jobCapUsd: defaults.jobCapUsd,
      timeoutSec: defaults.timeoutSec,
      permissionMode: perStep(steps, defaults.permissionMode),
      // The same shape `perStep` gives a one-step job either way — one
      // entry, named for the one step — differing only in where the
      // name came from.
      model: modelChoice ? { create: modelChoice } : perStep(steps, defaults.model),
      createTitle: title,
      createDescription: description,
      // Omitted entirely when nothing was chosen: "nothing chosen means
      // no line", all the way down.
      ...(dependsOn.length ? { createDependsOn: dependsOn } : {}),
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
  };
}

// A job read back from the mirror. Looser than a request (it carries
// id/state/results), but still validated: a corrupt row is dropped, not
// trusted.
function parseStoredJob(raw: unknown): Job | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return null;
  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) return null;
  if (!Array.isArray(r.steps) || r.steps.some((s) => !(WORKFLOW_STEPS as readonly string[]).includes(s as string))) {
    return null;
  }
  if (typeof r.state !== "string" || !(JOB_STATES as readonly string[]).includes(r.state)) return null;
  // Spec 149: a record written before the stop between steps was removed
  // still carries `gateAfter`. Left behind HERE rather than overwritten
  // below, because the spread is what would otherwise carry it straight
  // back out into the next mirror. A record whose STATE is the retired
  // one fails the check above and is dropped whole — the rule a corrupt
  // row has always had, and the three jobs it can apply to finished in
  // August.
  const { gateAfter: _retired, ...kept } = r;
  return {
    ...(kept as unknown as Job),
    steps: r.steps as WorkflowStep[],
    results: Array.isArray(r.results) ? (r.results as StepResult[]) : [],
    spentUsd: typeof r.spentUsd === "number" ? r.spentUsd : 0,
    // Undefined, never 0, when the mirror has no figure: the page shows
    // a dash for a job nothing measured, and a zero is a claim.
    spentTokens: typeof r.spentTokens === "number" ? r.spentTokens : undefined,
    stepIndex: typeof r.stepIndex === "number" ? r.stepIndex : 0,
    // Anything but a string here would be handed to a fetch and to a
    // file read. Dropped, like every other malformed field.
    sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
    streamFile: typeof r.streamFile === "string" ? r.streamFile : undefined,
    // Each `root` here becomes a git working directory on the merge
    // path, so a malformed entry is dropped rather than carried — the
    // same rule the two fields above already follow.
    branchUrls: Array.isArray(r.branchUrls) ? mergeBranchRefs([], r.branchUrls as BranchRef[]) : undefined,
    // Dropped on purpose. `landing` marks a merge in flight in THIS
    // process; a mirror read back after a restart has no such call behind
    // it, and the flag holds the whole queue shut for as long as it is
    // set — so a restored one would wedge it with nothing left to clear.
    landing: undefined,
  };
}

/** The project allowlist, as it is written in `queue-config.json`.
 *
 *  It used to be a `--queue-projects` argument baked into the launchd
 *  plist, so adding a project cost a plist re-render, an scp and a
 *  `launchctl bootout`/`bootstrap` — which is why adding one was four
 *  hand steps rather than a button (spec 112). Reading it from the
 *  config file the server ALREADY reads makes the change survive a
 *  restart without any of that; the CLI flag stays as the seed for a
 *  first install, where no config file exists yet.
 *
 *  `null` for anything malformed, so the caller keeps the flag rather
 *  than silently running with a shorter list — an empty ARRAY is a real
 *  answer ("nothing may be queued") and is returned as one. Each name is
 *  checked with the same rule a job's project is: these become directory
 *  names under the projects root. */
export function parseQueueProjects(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((p) => typeof p === "string" && NAME_RE.test(p) && !p.includes(".."))) return null;
  return raw as string[];
}

/** Write the allowlist back, keeping everything else in the file.
 *
 *  `projects` is passed in from the server's live `Set` — never read
 *  back out of the file and edited — so two changes in immediate
 *  succession cannot lose each other: each write carries the whole
 *  current answer, and the write itself is synchronous, which on one JS
 *  thread is what stops two of them interleaving. The other keys are
 *  read first because they are not ours to drop, and they are the one
 *  part a concurrent write could clobber — a risk taken deliberately
 *  over the alternative of this route owning the whole file's schema.
 *
 *  Written-then-renamed, exactly as `QueueStore.mirror()` does it: a
 *  half-written config is a server that comes up with no allowlist.
 *  Returns why it could not be written, or `null`. */
export function persistQueueProjects(file: string, projects: string[]): string | null {
  try {
    let raw: Record<string, unknown> = {};
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
    }
    raw.projects = [...projects];
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(raw, null, 2));
    renameSync(tmp, file);
    return null;
  } catch (err) {
    return `could not write ${file}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export interface QueueSettingsUpdate {
  model: Record<string, string>;
  budgetUsd: number;
  jobCapUsd: number;
  timeoutSec: Record<string, number>;
}

/** Atomically replace the dashboard-owned workflow defaults while leaving
 * comments, formatting, the fallback and future model keys intact. */
export function persistQueueSettings(file: string, next: QueueSettingsUpdate): string | null {
  try {
    if (!existsSync(file)) return `could not write ${file}: file does not exist`;
    let source = readFileSync(file, "utf-8");
    const errors: { error: number; offset: number; length: number }[] = [];
    const raw = parse(source, errors, { allowTrailingComma: true }) as unknown;
    if (errors.length || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return `could not write ${file}: invalid JSONC configuration`;
    }
    const opts = { formattingOptions: { insertSpaces: true, tabSize: 2 } };
    for (const [step, model] of Object.entries(next.model)) {
      source = applyEdits(source, modify(source, ["model", step], model, opts));
    }
    source = applyEdits(source, modify(source, ["budgetUsd"], next.budgetUsd, opts));
    source = applyEdits(source, modify(source, ["jobCapUsd"], next.jobCapUsd, opts));
    for (const [step, sec] of Object.entries(next.timeoutSec)) {
      source = applyEdits(source, modify(source, ["timeoutSec", step], sec, opts));
    }
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, source);
    renameSync(tmp, file);
    return null;
  } catch (err) {
    return `could not write ${file}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Caps and per-step policy belong in a file on the machine that runs
// the jobs, never in the code: a number that turns out wrong should
// cost a config edit and a restart, not a release.
export function mergeQueueDefaults(base: QueueDefaults, raw: unknown): QueueDefaults {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  // The numeric sibling of `table` below: `timeoutSec` is per step since
  // spec 152, and a file still carrying the old flat number is dropped
  // in favour of the built-in defaults rather than crashing — the same
  // direction every other malformed key here fails in.
  const numTable = (v: unknown, fallback: Record<string, number>) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return fallback;
    const out: Record<string, number> = { ...fallback };
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) out[k] = val;
    }
    return out;
  };
  const table = (v: unknown, fallback: Record<string, string>) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return fallback;
    const out: Record<string, string> = { ...fallback };
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string" && val) out[k] = val;
    }
    return out;
  };
  // A malformed entry is DROPPED, not defaulted: a model whose budget
  // is a typo would otherwise silently inherit the general one, and the
  // whole point of listing it is that its number is different.
  const choices = (v: unknown): Record<string, ModelChoice> | undefined => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return base.modelChoices;
    const out: Record<string, ModelChoice> = {};
    for (const [name, entry] of Object.entries(v as Record<string, unknown>)) {
      if (!NAME_RE.test(name) || entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.budgetUsd !== "number" || !Number.isFinite(e.budgetUsd) || e.budgetUsd <= 0) continue;
      const cap =
        typeof e.jobCapUsd === "number" && Number.isFinite(e.jobCapUsd) && e.jobCapUsd > 0
          ? e.jobCapUsd
          : undefined;
      // A malformed `tool` or `model` drops that FIELD, not the whole
      // entry: the budget is still a real grant, and an entry that
      // loses its tool falls back to claude — which is the default
      // every other entry already has.
      const choice: ModelChoice = cap === undefined
        ? { budgetUsd: e.budgetUsd }
        : { budgetUsd: e.budgetUsd, jobCapUsd: cap };
      if (e.tool === "claude" || e.tool === "codex") choice.tool = e.tool;
      if (typeof e.model === "string" && e.model) choice.model = e.model;
      out[name] = choice;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    budgetUsd: num(r.budgetUsd, base.budgetUsd),
    jobCapUsd: num(r.jobCapUsd, base.jobCapUsd),
    dailyCapUsd: num(r.dailyCapUsd, base.dailyCapUsd),
    timeoutSec: numTable(r.timeoutSec, base.timeoutSec),
    permissionMode: table(r.permissionMode, base.permissionMode),
    model: table(r.model, base.model),
    modelChoices: choices(r.modelChoices),
  };
}

export interface QueueOptions {
  defaults: QueueDefaults;
  resolve: ProjectResolver;
  mirrorPath?: string;
  cap?: number;
  /** Which projects may have a spec CREATED in them (spec 93). Absent
   *  means none: creating is off unless the server says otherwise, like
   *  every other capability here. */
  allowCreateProject?: CreateProjectAllower;
  /** Something in here moved (spec 189). Called after the write has
   *  landed and been mirrored, and only when one really landed — a
   *  refused enqueue or an unknown id changed nothing, and a page told
   *  otherwise would redraw for news it does not have. Absent means
   *  nobody is listening, which is what every test and every other
   *  caller of this class is. */
  onChange?: () => void;
}

export class QueueStore {
  private readonly jobs = new Map<string, Job>(); // insertion order = age order
  private readonly cap: number;
  private readonly mirrorPath?: string;
  readonly defaults: QueueDefaults;
  private readonly resolve: ProjectResolver;
  private readonly allowCreateProject: CreateProjectAllower;
  private readonly onChange: () => void;

  constructor(opts: QueueOptions) {
    this.cap = opts.cap ?? 200;
    this.mirrorPath = opts.mirrorPath;
    this.defaults = opts.defaults;
    this.resolve = opts.resolve;
    this.allowCreateProject = opts.allowCreateProject ?? (() => false);
    this.onChange = opts.onChange ?? (() => {});
    // Before `load()`, which is not a change: nothing is listening yet
    // on the first construction, and a mirror read back at boot is the
    // store finding out what it already was.
    this.load();
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
      return {
        ok: false,
        error:
          `${parsed.job.steps[0]} on ${parsed.job.specFolder} cannot start while its last step is still landing ` +
          `(job ${landing.id.slice(0, 8)}) — try again in a moment`,
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
    if (!job) return { ok: false, error: "no such job" };
    const named = step || "that step";
    const wanted = WORKFLOW_STEPS.find((s) => s === step);
    if (!wanted || !tailEdits(job).includes(wanted)) {
      // One sentence, and it names the step: the row has a single line
      // to say why a tick did not take.
      return {
        ok: false,
        error:
          job.state === "running"
            ? `${named} is not a step this run can still be given`
            : `${named} cannot be changed: this job is ${job.state}, not running`,
      };
    }
    const present = job.steps.includes(wanted);
    if (add === present) {
      return {
        ok: false,
        error: add ? `${named} is already part of this job` : `${named} is not part of this job`,
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
    if (!job) return { ok: false, error: "no such job" };
    const named = step || "that step";
    const wanted = WORKFLOW_STEPS.find((s) => s === step);
    if (!wanted || !tailEdits(job).includes(wanted)) {
      // One sentence, and it names the step — the row has a single line
      // to say why a pick did not take.
      return {
        ok: false,
        error:
          job.state === "running"
            ? `${named} is not a step this run can still be given`
            : `${named} cannot be changed: this job is ${job.state}, not running`,
      };
    }
    if (!NAME_RE.test(model)) return { ok: false, error: "invalid model" };
    const found = this.defaults.modelChoices?.[model];
    if (!found) {
      return {
        ok: false,
        error: this.defaults.modelChoices
          ? `unknown or not-allowed model: ${model}`
          : "no model choice is configured on this server",
      };
    }
    const next = { ...job, model: { ...job.model, [wanted]: model } };
    this.jobs.set(id, next);
    this.mirror();
    this.changed();
    return { ok: true, job: next };
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
}
