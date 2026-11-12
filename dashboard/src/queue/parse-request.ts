// Turning an HTTP body into a Job — the two shapes a request can take
// (an ordinary run, and a brand-new spec's `create`) and the rules
// shared between them.
//
// Two properties are security, not tidiness:
//   * a request carries NAMES, never paths — the server resolves the
//     project itself against the discovered, allowlisted set
//   * a request may only TIGHTEN a cap, and cannot set the permission
//     mode at all; widening what an unattended run may do is not
//     something an HTTP body gets to decide

import { DESCRIPTION_MAX } from "../project/description-bound.ts";
import { parseCreateChoices } from "./create-choices.ts";
import { listedModelName } from "./model-name.ts";
import { parseProviderPick } from "./providers/parse.ts";
import { ARCHIVE_ONLY_STEP, CLEANUP_KEY, DEPLOY_KEY, EFFORT_LEVELS, PHASE_STEPS, WORKFLOW_STEPS, type WorkflowStep } from "./steps.ts";
import type { CreateProjectAllower, Job, ProjectResolver, QueueDefaults } from "./types.ts";
import { resolveDependencyFolderName, specReference } from "../project/spec-folder.ts";
import { isScheduleKey, newProvisionalKey } from "../project/spec-names.ts";

export type ParseResult = { ok: true; job: Job } | ({ ok: false } & RequestRefusal);

import { fixInTheForm, invalidRequest, type RequestRefusal } from "../format/request-fixes.ts";
export { invalidRequest } from "../format/request-fixes.ts";

export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const FOLDER_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function perStep<T>(steps: WorkflowStep[], table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of steps) out[s] = table[s] ?? table.default;
  return out;
}

// A cap override is accepted only when it is stricter than the config.
type RequestError = Error & Pick<RequestRefusal, "solution">;

const requestError = (refusal: RequestRefusal): RequestError =>
  Object.assign(new Error(refusal.error), { solution: refusal.solution });

function tighten(raw: unknown, limit: number, name: string): number | RequestError {
  if (raw === undefined || raw === null) return limit;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return requestError(invalidRequest(`invalid ${name}`));
  if (raw > limit) return requestError(invalidRequest(`${name} may only be tightened (max ${limit})`));
  return raw;
}

/** The one table a posted model NAME is checked against.
 *
 *  It was `parseJobRequest`'s own closure until the New-spec form gained
 *  a Model choice of its own: two parsers now read a name off a request,
 *  and the sentence a refusal carries is the same sentence in both — a
 *  second copy would have drifted the first time one was reworded.
 *
 *  Two different answers, deliberately: a name that is merely not on the
 *  list, and a server that offers no list at all. Everything the choice
 *  is GRANTED comes from here; the request supplies only the name. */
export function lookUpModel(defaults: QueueDefaults, name: string): { name: string } | RequestRefusal {
  if (!defaults.modelChoices) return invalidRequest("no model choice is configured on this server");
  const listed = listedModelName(Object.keys(defaults.modelChoices), name);
  if ("name" in listed) return listed;
  const hint = listed.candidates.length ? ` (listed as ${listed.candidates.join(" or ")})` : "";
  return invalidRequest(`unknown or not-allowed model: ${name}${hint}`);
}

export function parseJobRequest(
  raw: unknown,
  opts: { resolve: ProjectResolver; defaults: QueueDefaults },
): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, ...invalidRequest("body is not an object") };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, ...invalidRequest("invalid project") };
  const resolved = opts.resolve(r.project);
  if (!resolved) return { ok: false, ...invalidRequest(`unknown or not-allowed project: ${r.project}`) };

  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) {
    return { ok: false, ...invalidRequest("invalid specFolder") };
  }
  // A `schedule` job never resolves under the specs root — a schedule
  // entry is not a spec, and its tracking key is a `schedule-<name>` key
  // instead, the same SHAPE `create`'s provisional
  // `new-<8hex>` key already has (though this exemption is new logic,
  // not a copy of `create`'s own — that one lives in a wholly separate
  // parser, `parseCreateRequest`). Gated on the STEPS actually being
  // exactly `["schedule"]`, never on the key's shape alone: a
  // specFolder that merely looks like a schedule key must not let
  // another step skip the "must already exist" check below.
  const isScheduleJob =
    Array.isArray(r.steps) && r.steps.length === 1 && r.steps[0] === "schedule";
  if (isScheduleJob && !isScheduleKey(r.specFolder)) {
    return { ok: false, ...invalidRequest("invalid specFolder: a schedule job's tracking key must start with schedule-") };
  }
  // The board's own deploy is no spec either: exactly `["deploy"]`, under the
  // tracking key `deploy` and no other, and that step under no other key.
  const isDeploy = Array.isArray(r.steps) && r.steps.length === 1 && r.steps[0] === "deploy";
  if (isDeploy && r.specFolder !== DEPLOY_KEY) {
    return { ok: false, ...invalidRequest(`invalid specFolder: a deploy job's tracking key must be ${DEPLOY_KEY}`) };
  }
  const isCleanup = Array.isArray(r.steps) && r.steps.length === 1 && r.steps[0] === "cleanup";
  if (isCleanup && r.specFolder !== CLEANUP_KEY) {
    return { ok: false, ...invalidRequest(`invalid specFolder: a cleanup job's tracking key must be ${CLEANUP_KEY}`) };
  }
  const archivedOnly =
    !resolved.specFolders.includes(r.specFolder) &&
    (resolved.archivedFolders ?? []).includes(r.specFolder);
  if (!isScheduleJob && !isDeploy && !isCleanup && !resolved.specFolders.includes(r.specFolder) && !archivedOnly) {
    return { ok: false, ...invalidRequest(`unknown specFolder: ${specReference(r.project, r.specFolder)}`) };
  }

  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 8) {
    return { ok: false, ...invalidRequest("steps must be a list of 1-8 workflow steps") };
  }
  const steps: WorkflowStep[] = [];
  for (const s of r.steps) {
    if (typeof s !== "string" || !(WORKFLOW_STEPS as readonly string[]).includes(s)) {
      return { ok: false, ...invalidRequest(`invalid entry in steps: ${String(s)}`) };
    }
    steps.push(s as WorkflowStep);
  }
  if (!isDeploy && steps.includes("deploy")) {
    return { ok: false, ...invalidRequest("invalid entry in steps: deploy runs alone, under the deploy key") };
  }
  if (!isCleanup && steps.includes("cleanup")) {
    return { ok: false, ...invalidRequest("invalid entry in steps: cleanup runs alone, under the cleanup key") };
  }

  // Checked here rather than beside the folder lookup above, so that the
  // errors keep the order they have always had: a request with a folder
  // nobody knows still hears about the folder first. An archived spec is
  // admitted for `reopen` alone — every other step is refused
  // by name here, and `aide-run-spec`'s own `--spec` gate refuses it a
  // second time for a run started by hand.
  if (archivedOnly && steps.some((s) => s !== ARCHIVE_ONLY_STEP)) {
    // "closed" and "archived" must never blur into one
    // word even in a refusal sentence — the gate itself (only `reopen`
    // is legal) is unchanged either way.
    const closed = (resolved.closedFolders ?? []).includes(r.specFolder);
    return {
      ok: false,
      ...invalidRequest(
        `${specReference(r.project, r.specFolder)} is ${closed ? "closed" : "archived"} — only ${ARCHIVE_ONLY_STEP} can be asked for it`,
      ),
    };
  }
  // The mirrored direction: `reopen` exists to bring an
  // archived spec back, so a request for it against a spec already in
  // `specFolders` is not a legitimate case, only a stale board row or a
  // caller that skipped the archived check above. `!archivedOnly` is not
  // needed here — `archivedOnly` already requires
  // `!resolved.specFolders.includes(...)`, so the two conditions cannot
  // both be true.
  if (steps.includes(ARCHIVE_ONLY_STEP) && resolved.specFolders.includes(r.specFolder)) {
    return {
      ok: false,
      ...invalidRequest(`${specReference(r.project, r.specFolder)} is already active — nothing to ${ARCHIVE_ONLY_STEP}`),
    };
  }

  // `gateAfter` (a list of steps to stop after) is an unknown key, and
  // unknown keys are ignored rather than refused (see the header): the
  // three jobs that ever carried one were posted as JSON by hand, and
  // refusing the field would turn a retired feature into a new error.

  // `extraProjects` was parsed here — passenger repos a run would also
  // branch, commit and push, named on the row by a tick box per project.
  // The box went when 0 of the queue's 200 jobs turned out to have used
  // one, and the field went with it. Like `gateAfter` above it is an
  // unknown key now, ignored rather than refused, so the jobs that
  // carry one still load.

  // A model may be picked for the whole job — that is how the heaviest
  // model is reserved for the heaviest work — or once per STEP, which
  // is what the phase lines post. The NAME comes from
  // the request either way; everything it is granted comes from the
  // config, looked up in exactly the same table.
  let modelChoice: string | undefined;
  let stepModels: Record<string, string> | undefined;
  if (typeof r.model === "string" && r.model !== "") {
    if (!NAME_RE.test(r.model)) return { ok: false, ...invalidRequest("invalid model") };
    const found = lookUpModel(defaults, r.model);
    if ("error" in found) return { ok: false, ...found };
    modelChoice = found.name;
  } else if (r.model !== undefined && r.model !== null && r.model !== "") {
    // The per-step shape. An empty string keeps meaning "use the
    // configuration" — the branch above lets it fall through here, and
    // this guard has to let it fall through again rather than call it a
    // malformed object.
    if (typeof r.model !== "object" || Array.isArray(r.model)) return { ok: false, ...invalidRequest("invalid model") };
    stepModels = {};
    for (const [step, name] of Object.entries(r.model as Record<string, unknown>)) {
      // A phase left on "default" posts nothing to apply. Skipped, not
      // refused: the config's own per-step choice is the answer.
      if (name === undefined || name === null || name === "") continue;
      // Skipped, not refused: since the phase lines' selects are always
      // pre-filled (2026-08-19), every Run posts a name for all five
      // steps, whichever are ticked. Only the ticked ones apply.
      if (!steps.includes(step as WorkflowStep)) continue;
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, ...invalidRequest(`invalid model for ${step}`) };
      const found = lookUpModel(defaults, name);
      if ("error" in found) return { ok: false, ...found };
      stepModels[step] = found.name;
    }
  }

  const jobModel: Record<string, string> = modelChoice
    ? Object.fromEntries(steps.map((s) => [s, modelChoice]))
    : { ...perStep(steps, defaults.model), ...stepModels };
  const picked = parseProviderPick(r.provider, steps, jobModel, defaults);
  if ("error" in picked) return { ok: false, ...picked };

  // The effort level a step runs at, per step — the same
  // per-step shape `stepModels` above takes, but with no whole-job
  // pick and no config lookup: the value IS the level, checked directly
  // against the fixed EFFORT_LEVELS list. An empty/untouched entry is
  // skipped, not refused — "the phase select posts an empty
  // value" is a real, valid resting state for effort, unlike model's
  // select, which is always pre-filled with a real name.
  const stepEffort: Record<string, string> = {};
  if (r.effort !== undefined && r.effort !== null && r.effort !== "") {
    if (typeof r.effort !== "object" || Array.isArray(r.effort)) return { ok: false, ...invalidRequest("invalid effort") };
    for (const [step, level] of Object.entries(r.effort as Record<string, unknown>)) {
      if (level === undefined || level === null || level === "") continue;
      if (!steps.includes(step as WorkflowStep)) continue;
      if (typeof level !== "string" || !(EFFORT_LEVELS as readonly string[]).includes(level)) {
        return { ok: false, ...invalidRequest(`invalid effort for ${step}: ${String(level)}`) };
      }
      stepEffort[step] = level;
    }
  }

  // `acceptanceNotRequired` is not parsed: the choice is recorded on the
  // spec itself (`specAcceptanceNotRequired`, read fresh at spawn time),
  // so a second job for an existing spec has nothing left to post. Like
  // `gateAfter` above it is an unknown key, ignored rather than refused.

  // Why a `close` step is closing the spec — typed
  // by the person closing it, refused empty by close-controls.ts's own
  // POST route before a request ever reaches here, so an empty string
  // reaching this parser is only ever a hand-crafted request; bounded
  // for the same reason `description`, below, is.
  let closeReason: string | undefined;
  if (steps.includes("close")) {
    if (typeof r.closeReason !== "string" || r.closeReason.trim() === "") {
      return { ok: false, ...invalidRequest("a close step requires a reason") };
    }
    // A form posts a textarea's line break as CRLF, and the field counts it as
    // one character: fold it as `text()` does, or a reason the field holds
    // at its bound is refused here.
    if (r.closeReason.replace(/\r\n?/g, "\n").length > CLOSE_REASON_MAX) {
      return { ok: false, ...invalidRequest(`closeReason may be at most ${CLOSE_REASON_MAX} characters`) };
    }
    closeReason = r.closeReason.trim();
  }

  // Whether a reopen also resets the three files. Only a job that
  // is exactly one `reopen` step can carry it.
  const resetFiles =
    steps.length === 1 && steps[0] === "reopen" &&
    (r.resetFiles === true || r.resetFiles === "1" || r.resetFiles === "on");
  let groupMembers: string[] | undefined; let groupBranch: string | undefined;
  const executionGroupId = typeof r.executionGroupId === "string" && /^[A-Za-z0-9-]+$/.test(r.executionGroupId) ? r.executionGroupId : undefined;
  if (r.executionGroupId !== undefined && !executionGroupId) return { ok: false, ...invalidRequest("invalid executionGroupId") };
  if (r.groupMembers !== undefined || r.groupBranch !== undefined) {
    if (steps.length !== 1 || steps[0] !== "archive") return { ok: false, ...invalidRequest("group fields are for archive only") };
    if (!Array.isArray(r.groupMembers) || r.groupMembers.length < 2 ||
        r.groupMembers.some((member) => typeof member !== "string" || !FOLDER_RE.test(member))) {
      return { ok: false, ...invalidRequest("invalid groupMembers") };
    }
    if (typeof r.groupBranch !== "string" || !/^aide\/group-[A-Za-z0-9._/-]+$/.test(r.groupBranch)) {
      return { ok: false, ...invalidRequest("invalid groupBranch") };
    }
    groupMembers = [...new Set(r.groupMembers as string[])]; groupBranch = r.groupBranch;
    if (!groupMembers.includes(r.specFolder)) return { ok: false, ...invalidRequest("the archive owner must be a group member") };
  }

  // Per step, each against its OWN ceiling: an override that would be a
  // tightening for implement can be a loosening for analyze, and the
  // job holding both may not buy the one by naming the other.
  const timeoutLimits = perStep(steps, defaults.timeoutSec);
  const timeoutSec: Record<string, number> = {};
  for (const s of steps) {
    const t = tighten(r.timeoutSec, timeoutLimits[s]!, "timeoutSec");
    if (t instanceof Error) return { ok: false, error: t.message, solution: t.solution };
    timeoutSec[s] = t;
  }

  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      executionGroupId, project: r.project,
      specFolder: r.specFolder,
      groupMembers,
      groupBranch,
      steps,
      stepIndex: 0,
      state: "queued",
      timeoutSec,
      permissionMode: perStep(steps, defaults.permissionMode),
      // A whole-job pick applies to EVERY step: "reserve the heavy
      // model for the heavy job" is a decision about the job. A
      // per-step map overrides only the steps it names, and every
      // other step keeps the config's own choice.
      model: jobModel,
      ...(Object.keys(picked.provider).length ? { provider: picked.provider } : {}),
      // Left unset for a per-step map: it means "one model for the
      // whole job", which is no longer true once the steps may differ.
      modelChoice,
      effort: stepEffort,
      closeReason,
      ...(resetFiles ? { resetFiles: true } : {}),
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
  };
}

// --- a spec that does not exist yet -------------------------------

/** How long the two free-text fields may be. Bounded for the same reason
 *  every other field here is: they end up as arguments to an unattended
 *  run, and a prompt is not the place to discover that somebody pasted a
 *  document into a title.
 *
 *  A description holds a problem, a solution and a table of acceptance
 *  criteria, and 2,000 characters cut a spec of eleven criteria off in
 *  the middle (2026-09-20). */
export const TITLE_MAX = 120;
export { DESCRIPTION_MAX };
/** A Close reason's bound: its own, so the description's can move without it. */
export const CLOSE_REASON_MAX = 5000;

/** Anything a terminal, an argv or a prompt would read as structure. A
 *  newline is allowed in the description and nowhere else: a description
 *  is a paragraph, a title is a line. */
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/;

function text(raw: unknown, max: number, name: string, multiline = false): string | RequestError {
  if (typeof raw !== "string") return requestError(invalidRequest(`invalid ${name}`));
  const value = raw.replace(/\r\n?/g, "\n").trim();
  if (!value) return requestError(fixInTheForm(`${name} is required`));
  if (value.length > max) return requestError(fixInTheForm(`${name} is too long (max ${max})`));
  if (CONTROL_CHARS.test(value)) return requestError(fixInTheForm(`${name} contains control characters`));
  if (!multiline && value.includes("\n")) return requestError(fixInTheForm(`${name} must be one line`));
  return value;
}

/** `parseCreateRequest`'s own return shape, widened over the base
 *  `ParseResult`: the picks banked for a phase this create job does not
 *  run are consumed by its one caller, `enqueueCreate()`, not
 *  carried on the job itself. */
export type CreateParseResult = ParseResult & {
  pendingStepModels?: Record<string, string>;
  pendingStepProviders?: Record<string, string>;
};

export function parseCreateRequest(
  raw: unknown,
  opts: { allow: CreateProjectAllower; resolve?: ProjectResolver; defaults: QueueDefaults },
): CreateParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, ...invalidRequest("body is not an object") };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  // No project named at all: an untouched form posts `project=`, a raw
  // request may leave the key out. Said in its own words, ahead of "invalid
  // project", which is for a name that is present and wrong.
  if (r.project === undefined || r.project === null || r.project === "") {
    return { ok: false, ...fixInTheForm("project is required") };
  }
  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, ...invalidRequest("invalid project") };
  if (!opts.allow(r.project)) return { ok: false, ...invalidRequest(`unknown or not-allowed project: ${r.project}`) };

  const title = text(r.title, TITLE_MAX, "title");
  if (title instanceof Error) return { ok: false, error: title.message, solution: title.solution };
  const description = text(r.description, DESCRIPTION_MAX, "description", true);
  if (description instanceof Error) return { ok: false, error: description.message, solution: description.solution };

  // Resolve dependencies inside this project's specs root, using the
  // server's known folders rather than the browser's rendered choices.
  // One bad entry refuses the whole list; nothing is silently dropped.
  const dependsOn: string[] = [];
  if (r.dependsOn !== undefined && r.dependsOn !== null) {
    if (!Array.isArray(r.dependsOn)) return { ok: false, ...invalidRequest("dependsOn must be a list") };
    if (r.dependsOn.length > 20) return { ok: false, ...invalidRequest("dependsOn: at most 20") };
    // No resolver, no known specs. An archived spec counts: one archived
    // since the form was drawn is a dependency already met.
    const resolved = opts.resolve?.(r.project);
    const known = [...(resolved?.specFolders ?? []), ...(resolved?.archivedFolders ?? [])];
    for (const d of r.dependsOn) {
      const folder = typeof d === "string" && FOLDER_RE.test(d)
        ? resolveDependencyFolderName(known, d)
        : undefined;
      if (!folder) {
        return { ok: false, ...invalidRequest(`unknown spec in dependsOn: ${String(d)}`) };
      }
      if (dependsOn.includes(folder)) return { ok: false, ...invalidRequest(`dependsOn repeats ${d}`) };
      dependsOn.push(folder);
    }
  }

  // Which phases this job runs, beyond `create` itself. The
  // New spec page's own phase table posts the same repeated `steps`
  // field the Specs list's row does, bounded to the same three phases
  // that row may tick (`PHASE_STEPS`) — never `create` a second time,
  // and never a step outside the workflow's own vocabulary. Omitted
  // entirely, an untouched form's `steps` is exactly `["create"]`,
  // identical to today's behaviour.
  const extraSteps: WorkflowStep[] = [];
  if (r.steps !== undefined && r.steps !== null) {
    if (!Array.isArray(r.steps)) return { ok: false, error: "steps must be a list" };
    for (const s of r.steps) {
      if (typeof s !== "string" || !(PHASE_STEPS as readonly string[]).includes(s)) {
        return { ok: false, error: `invalid entry in steps: ${String(s)}` };
      }
      if (!extraSteps.includes(s as WorkflowStep)) extraSteps.push(s as WorkflowStep);
    }
  }
  const steps: WorkflowStep[] = ["create", ...extraSteps];

  // Which model each of those steps is run ON. Every step BUT `create` could already be pointed at one
  // from its own phase line; `create` MAKES the spec those lines belong
  // to, so there is no row to pick it from and the New-spec form is
  // where the choice is made instead — now for every step this job may
  // run, not `create` alone.
  //
  // The per-step shape, which is what `bodyToObject` already folds a
  // posted `model.<step>=` into — the same shape, and the same table
  // (`lookUpModel`), as every phase line's pick, so a name accepted here
  // is a name `parseJobRequest` would accept too. An empty value keeps
  // meaning "the configuration decides": that is what an untouched
  // select posts, and what a form with no Model field at all leaves out.
  const stepModels: Record<string, string> = {};
  const pendingStepModels: Record<string, string> = {};
  if (r.model !== undefined && r.model !== null && r.model !== "") {
    if (typeof r.model !== "object" || Array.isArray(r.model)) return { ok: false, ...invalidRequest("invalid model") };
    // A name posted for a step this job does not run is not refused —
    // the rule `parseJobRequest` already follows, since a browser posts
    // every select it drew, whichever boxes are ticked — but a REAL
    // phase's pick is not dropped either: it is banked as a
    // pending choice for that phase, the same way the New page's own
    // phase table lines up with the Specs list row's model picker. A
    // key that names no real phase at all (junk, an unrelated field)
    // still falls through unvalidated, exactly as before.
    for (const [step, name] of Object.entries(r.model as Record<string, unknown>)) {
      if (name === undefined || name === null || name === "") continue;
      const runsNow = steps.includes(step as WorkflowStep);
      if (!runsNow && !(PHASE_STEPS as readonly string[]).includes(step)) continue;
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, ...invalidRequest(`invalid model for ${step}`) };
      const found = lookUpModel(defaults, name);
      if ("error" in found) return { ok: false, ...found };
      if (runsNow) stepModels[step] = found.name;
      else pendingStepModels[step] = found.name;
    }
  }

  const createModel = { ...perStep(steps, defaults.model), ...stepModels };
  const picked = parseProviderPick(r.provider, steps, createModel, defaults, pendingStepModels);
  if ("error" in picked) return { ok: false, ...picked };

  // The form's choices about the spec beyond its text (create-choices.ts).
  const choices = parseCreateChoices(r);
  if ("error" in choices) return { ok: false, ...invalidRequest(choices.error) };

  return {
    ok: true,
    job: {
      id: crypto.randomUUID(),
      project: r.project,
      specFolder: newProvisionalKey(),
      steps,
      stepIndex: 0,
      state: "queued",
      timeoutSec: defaults.timeoutSec,
      permissionMode: perStep(steps, defaults.permissionMode),
      // The config's own default for every step this job runs,
      // overridden per step by whatever was actually posted.
      model: createModel,
      ...(Object.keys(picked.provider).length ? { provider: picked.provider } : {}),
      createTitle: title,
      createDescription: description,
      // Omitted entirely when nothing was chosen: "nothing chosen means
      // no line", all the way down.
      ...(dependsOn.length ? { createDependsOn: dependsOn } : {}),
      ...choices.fields,
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
    ...(Object.keys(pendingStepModels).length ? { pendingStepModels } : {}),
    ...(Object.keys(picked.pending).length ? { pendingStepProviders: picked.pending } : {}),
  };
}
