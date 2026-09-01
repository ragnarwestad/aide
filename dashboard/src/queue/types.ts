// The shapes the queue trades in: a job, its results, and the config
// that bounds what a request may ask for.

import type { JobState, StopReason, WorkflowStep } from "./steps.ts";

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
  /** Why the branch itself did not reach origin (spec 328). Not an
   *  `error`: the step succeeded and its work is committed, only the
   *  push failed — `prError`'s sibling, same shape, its own field for
   *  the same reason. */
  pushError?: string;
  /** A landing merged this job's branch but could not delete it on
   *  origin (spec 319): `mergeBranchIntoDefault`'s own `branchDeleteError`,
   *  carried forward so a row built long after this job ran can still
   *  say what actually happened, rather than a generic "not landed".
   *  Cleared, like `error`, the moment a later landing for the same spec
   *  deletes the branch cleanly. */
  branchDeleteError?: string;
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
  /** The first landing failure this job hit, named by step (spec 327).
   *  Set once and left alone by every later step of the SAME job,
   *  success or failure — unlike `error`, which every later step is
   *  free to overwrite the moment it starts (`Runner.startOne()`) or
   *  lands. `errorReason`/`error` still say what is happening RIGHT
   *  NOW; this says what already went wrong and was never resolved. */
  landingError?: string;
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

/** Whether this project may have a spec CREATED in it. The raw
 *  allowlist, deliberately — not `ProjectResolver`, which answers "not
 *  found" for a project with no spec on disk yet. That gap is exactly
 *  what makes a project's first spec uncreatable, and widening the
 *  resolver itself would widen every other route with it. */
export type CreateProjectAllower = (project: string) => boolean;
