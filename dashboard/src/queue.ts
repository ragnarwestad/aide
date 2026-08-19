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

export const WORKFLOW_STEPS = [
  "explore", "create", "analyze", "review-plan", "implement", "archive", "manifest",
  // Spec 106: not part of the workflow's own order — it is the way out
  // of a merge the Merge button refused, queued from the row that
  // refused it. `core/scripts/aide-run-spec` keeps the same list in a
  // bash string with no shared source between them; a python test
  // (`test_aide_run_spec.py`) compares the two.
  "resolve",
] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

export const JOB_STATES = [
  "queued", "running", "awaiting-approval", "done",
  "stopped", "failed", "cancelled", "interrupted",
] as const;
export type JobState = (typeof JOB_STATES)[number];

// Why a run ended early. `stopped` is deliberately not `failed`: with
// tight caps a cap-stop is a common, healthy outcome, and a reader who
// cannot tell it from a broken agent will start ignoring both.
export type StopReason = "budget" | "timeout";

/** States where a job still owns its work. Anything else has released
 *  it, and the same step may be queued again. */
const UNFINISHED = new Set<string>(["queued", "running", "awaiting-approval"]);

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
  gateAfter: WorkflowStep[];
  stepIndex: number;
  state: JobState;
  budgetUsd: number;
  jobCapUsd: number;
  timeoutSec: number;
  permissionMode: Record<string, string>;
  model: Record<string, string>;
  /** The model picked for this whole job, when one was picked. Absent
   *  means the per-step configuration decided. */
  modelChoice?: string;
  /** Other allowlisted projects this job is expected to touch. They are
   *  watched, branched, committed and pushed exactly like the primary —
   *  spec 81's own implement step wrote to a third repository the run
   *  knew nothing about, and that half sat uncommitted on the machine
   *  while the result reported success. */
  extraProjects: string[];
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
  stopReason?: StopReason;
  error?: string;
}

/** What one pickable model is granted. The budget lives HERE, not in
 *  the request: a hungrier model needs more headroom per step, and the
 *  only place allowed to grant headroom is the config file on the
 *  machine that runs the jobs. */
export interface ModelChoice {
  budgetUsd: number;
  jobCapUsd?: number;
}

export interface QueueDefaults {
  budgetUsd: number;
  jobCapUsd: number;
  dailyCapUsd: number;
  timeoutSec: number;
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
export type ProjectResolver = (project: string) => { specFolders: string[] } | null;

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
  if (!resolved.specFolders.includes(r.specFolder)) {
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

  // Default: every step gates. A job may be posted with an empty list
  // to run straight through.
  let gateAfter: WorkflowStep[] = [...steps];
  if (r.gateAfter !== undefined && r.gateAfter !== null) {
    if (!Array.isArray(r.gateAfter)) return { ok: false, error: "gateAfter must be a list" };
    gateAfter = [];
    for (const g of r.gateAfter) {
      if (typeof g !== "string" || !steps.includes(g as WorkflowStep)) {
        return { ok: false, error: `gateAfter names a step not in this job: ${String(g)}` };
      }
      gateAfter.push(g as WorkflowStep);
    }
  }

  // Passenger projects: NAMES, resolved against the same allowlist as
  // the primary. A request never carries a path.
  const extraProjects: string[] = [];
  if (r.extraProjects !== undefined && r.extraProjects !== null) {
    if (!Array.isArray(r.extraProjects)) return { ok: false, error: "extraProjects must be a list" };
    if (r.extraProjects.length > 4) return { ok: false, error: "extraProjects: at most 4" };
    for (const p of r.extraProjects) {
      if (typeof p !== "string" || !NAME_RE.test(p)) {
        return { ok: false, error: `invalid entry in extraProjects: ${String(p)}` };
      }
      if (p === r.project) {
        return { ok: false, error: `extraProjects repeats the job's own project: ${p}` };
      }
      if (extraProjects.includes(p)) return { ok: false, error: `extraProjects repeats ${p}` };
      if (!opts.resolve(p)) return { ok: false, error: `unknown or not-allowed project in extraProjects: ${p}` };
      extraProjects.push(p);
    }
  }

  // A model may be picked for the whole job — that is how the heaviest
  // model is reserved for the heaviest work — or once per STEP, which
  // is what the phase lines post since spec 123. The NAME comes from
  // the request either way; everything it is granted comes from the
  // config, looked up in exactly the same table.
  let modelChoice: string | undefined;
  let choice: ModelChoice | undefined;
  let stepModels: Record<string, string> | undefined;
  const lookUp = (name: string): ModelChoice | { error: string } => {
    const found = defaults.modelChoices?.[name];
    if (found) return found;
    return {
      error: defaults.modelChoices
        ? `unknown or not-allowed model: ${name}`
        : "no model choice is configured on this server",
    };
  };
  if (typeof r.model === "string" && r.model !== "") {
    if (!NAME_RE.test(r.model)) return { ok: false, error: "invalid model" };
    const found = lookUp(r.model);
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
      if (!steps.includes(step as WorkflowStep)) {
        return { ok: false, error: `model names a step not in this job: ${step}` };
      }
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, error: `invalid model for ${step}` };
      const found = lookUp(name);
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
  const timeoutSec = tighten(r.timeoutSec, defaults.timeoutSec, "timeoutSec");
  if (timeoutSec instanceof Error) return { ok: false, error: timeoutSec.message };

  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      project: r.project,
      specFolder: r.specFolder,
      steps,
      gateAfter,
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
      extraProjects,
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

  const steps: WorkflowStep[] = ["create"];
  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      project: r.project,
      specFolder: provisionalKey(),
      steps,
      // Nothing to gate on: a create job is one step, and a gate after
      // the last step parks a job nobody has anything left to approve.
      gateAfter: [],
      stepIndex: 0,
      state: "queued",
      budgetUsd: defaults.budgetUsd,
      jobCapUsd: defaults.jobCapUsd,
      timeoutSec: defaults.timeoutSec,
      permissionMode: perStep(steps, defaults.permissionMode),
      model: perStep(steps, defaults.model),
      extraProjects: [],
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
  return {
    ...(r as unknown as Job),
    steps: r.steps as WorkflowStep[],
    gateAfter: Array.isArray(r.gateAfter) ? (r.gateAfter as WorkflowStep[]) : [],
    extraProjects: Array.isArray(r.extraProjects) ? (r.extraProjects as string[]) : [],
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

// Caps and per-step policy belong in a file on the machine that runs
// the jobs, never in the code: a number that turns out wrong should
// cost a config edit and a restart, not a release.
export function mergeQueueDefaults(base: QueueDefaults, raw: unknown): QueueDefaults {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
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
      out[name] = cap === undefined ? { budgetUsd: e.budgetUsd } : { budgetUsd: e.budgetUsd, jobCapUsd: cap };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    budgetUsd: num(r.budgetUsd, base.budgetUsd),
    jobCapUsd: num(r.jobCapUsd, base.jobCapUsd),
    dailyCapUsd: num(r.dailyCapUsd, base.dailyCapUsd),
    timeoutSec: num(r.timeoutSec, base.timeoutSec),
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
}

export class QueueStore {
  private readonly jobs = new Map<string, Job>(); // insertion order = age order
  private readonly cap: number;
  private readonly mirrorPath?: string;
  readonly defaults: QueueDefaults;
  private readonly resolve: ProjectResolver;
  private readonly allowCreateProject: CreateProjectAllower;

  constructor(opts: QueueOptions) {
    this.cap = opts.cap ?? 200;
    this.mirrorPath = opts.mirrorPath;
    this.defaults = opts.defaults;
    this.resolve = opts.resolve;
    this.allowCreateProject = opts.allowCreateProject ?? (() => false);
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
    this.jobs.set(parsed.job.id, parsed.job);
    while (this.jobs.size > this.cap) {
      this.jobs.delete(this.jobs.keys().next().value as string);
    }
    this.mirror();
    return parsed;
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

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next = { ...job, ...patch };
    this.jobs.set(id, next);
    this.mirror();
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
