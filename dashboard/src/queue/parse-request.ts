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

import { errorSentence } from "../format/error-sentence.ts";
import { ARCHIVE_ONLY_STEP, EFFORT_LEVELS, PHASE_STEPS, WORKFLOW_STEPS, type WorkflowStep } from "./steps.ts";
import type { CreateProjectAllower, Job, ModelChoice, ProjectResolver, QueueDefaults } from "./types.ts";

export type ParseResult = { ok: true; job: Job } | { ok: false; error: string };

/** Every refusal in this file answers a request the ordinary Run/New-
 *  spec form does not normally post (2-analysis.md): most of these are
 *  reachable only from a hand-crafted request, and the rest from a page
 *  left open long enough for its own project/spec/model list to go
 *  stale before the post landed. What resolves either one is the same,
 *  so it is wrapped once here rather than worded by hand per call site
 *  (REQ-1, spec 352). */
export const invalidRequest = (what: string): string =>
  errorSentence({
    what,
    resolve: "Reload the page and try again — or, if this came from a raw request, check the field this names.",
  }).text;

export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const FOLDER_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function perStep<T>(steps: WorkflowStep[], table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of steps) out[s] = table[s] ?? table.default;
  return out;
}

// A cap override is accepted only when it is stricter than the config.
function tighten(raw: unknown, limit: number, name: string): number | Error {
  if (raw === undefined || raw === null) return limit;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return new Error(invalidRequest(`invalid ${name}`));
  if (raw > limit) return new Error(invalidRequest(`${name} may only be tightened (max ${limit})`));
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
    error: invalidRequest(
      defaults.modelChoices
        ? `unknown or not-allowed model: ${name}`
        : "no model choice is configured on this server",
    ),
  };
}

export function parseJobRequest(
  raw: unknown,
  opts: { resolve: ProjectResolver; defaults: QueueDefaults },
): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: invalidRequest("body is not an object") };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, error: invalidRequest("invalid project") };
  const resolved = opts.resolve(r.project);
  if (!resolved) return { ok: false, error: invalidRequest(`unknown or not-allowed project: ${r.project}`) };

  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) {
    return { ok: false, error: invalidRequest("invalid specFolder") };
  }
  // A `schedule` job never resolves under the specs root — a schedule
  // entry is not a spec, and its tracking key is a `schedule-<name>` key
  // instead (spec 259), the same SHAPE `create`'s provisional
  // `new-<8hex>` key already has (though this exemption is new logic,
  // not a copy of `create`'s own — that one lives in a wholly separate
  // parser, `parseCreateRequest`). Gated on the STEPS actually being
  // exactly `["schedule"]`, never on the key's shape alone: a
  // specFolder that merely looks like a schedule key must not let
  // another step skip the "must already exist" check below.
  const isScheduleJob =
    Array.isArray(r.steps) && r.steps.length === 1 && r.steps[0] === "schedule";
  if (isScheduleJob && !r.specFolder.startsWith("schedule-")) {
    return { ok: false, error: invalidRequest("invalid specFolder: a schedule job's tracking key must start with schedule-") };
  }
  const archivedOnly =
    !resolved.specFolders.includes(r.specFolder) &&
    (resolved.archivedFolders ?? []).includes(r.specFolder);
  if (!isScheduleJob && !resolved.specFolders.includes(r.specFolder) && !archivedOnly) {
    return { ok: false, error: invalidRequest(`unknown specFolder: ${r.specFolder}`) };
  }

  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 8) {
    return { ok: false, error: invalidRequest("steps must be a list of 1-8 workflow steps") };
  }
  const steps: WorkflowStep[] = [];
  for (const s of r.steps) {
    if (typeof s !== "string" || !(WORKFLOW_STEPS as readonly string[]).includes(s)) {
      return { ok: false, error: invalidRequest(`invalid entry in steps: ${String(s)}`) };
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
    // spec 406, REQ-7: "closed" and "archived" must never blur into one
    // word even in a refusal sentence — the gate itself (only `reopen`
    // is legal) is unchanged either way.
    const closed = (resolved.closedFolders ?? []).includes(r.specFolder);
    return {
      ok: false,
      error: invalidRequest(
        `${r.specFolder} is ${closed ? "closed" : "archived"} — only ${ARCHIVE_ONLY_STEP} can be asked for it`,
      ),
    };
  }
  // The mirrored direction (spec 270): `reopen` exists to bring an
  // archived spec back, so a request for it against a spec already in
  // `specFolders` is not a legitimate case, only a stale board row or a
  // caller that skipped the archived check above. `!archivedOnly` is not
  // needed here — `archivedOnly` already requires
  // `!resolved.specFolders.includes(...)`, so the two conditions cannot
  // both be true.
  if (steps.includes(ARCHIVE_ONLY_STEP) && resolved.specFolders.includes(r.specFolder)) {
    return {
      ok: false,
      error: invalidRequest(`${r.specFolder} is already active — nothing to ${ARCHIVE_ONLY_STEP}`),
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
    if (!NAME_RE.test(r.model)) return { ok: false, error: invalidRequest("invalid model") };
    const found = lookUpModel(defaults, r.model);
    if ("error" in found) return { ok: false, error: found.error };
    choice = found;
    modelChoice = r.model;
  } else if (r.model !== undefined && r.model !== null && r.model !== "") {
    // The per-step shape. An empty string keeps meaning "use the
    // configuration" — the branch above lets it fall through here, and
    // this guard has to let it fall through again rather than call it a
    // malformed object.
    if (typeof r.model !== "object" || Array.isArray(r.model)) return { ok: false, error: invalidRequest("invalid model") };
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
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, error: invalidRequest(`invalid model for ${step}`) };
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

  // The effort level a step runs at (spec 364), per step — the same
  // per-step shape `stepModels` above takes, but with no whole-job
  // pick and no config lookup: the value IS the level, checked directly
  // against the fixed EFFORT_LEVELS list. An empty/untouched entry is
  // skipped, not refused (REQ-4) — "the phase select posts an empty
  // value" is a real, valid resting state for effort, unlike model's
  // select, which is always pre-filled with a real name.
  const stepEffort: Record<string, string> = {};
  if (r.effort !== undefined && r.effort !== null && r.effort !== "") {
    if (typeof r.effort !== "object" || Array.isArray(r.effort)) return { ok: false, error: invalidRequest("invalid effort") };
    for (const [step, level] of Object.entries(r.effort as Record<string, unknown>)) {
      if (level === undefined || level === null || level === "") continue;
      if (!steps.includes(step as WorkflowStep)) continue;
      if (typeof level !== "string" || !(EFFORT_LEVELS as readonly string[]).includes(level)) {
        return { ok: false, error: invalidRequest(`invalid effort for ${step}: ${String(level)}`) };
      }
      stepEffort[step] = level;
    }
  }

  // `acceptanceNotRequired` was parsed here until spec 394 — spec 386's
  // whole-job checkbox, read by `analyze`'s own invocation alone. The
  // choice is recorded on the spec itself now
  // (`specAcceptanceNotRequired`, read fresh at spawn time), so a second
  // job for an existing spec has nothing left to post; the specs-list
  // row that used to post it is gone (REQ-8). Like `gateAfter` above it
  // is an unknown key now, ignored rather than refused.

  // spec 406, REQ-3/REQ-5: why a `close` step is closing the spec — typed
  // by the person closing it, refused empty by close-controls.ts's own
  // POST route before a request ever reaches here, so an empty string
  // reaching this parser is only ever a hand-crafted request; bounded
  // for the same reason `description`, below, is.
  let closeReason: string | undefined;
  if (steps.includes("close")) {
    if (typeof r.closeReason !== "string" || r.closeReason.trim() === "") {
      return { ok: false, error: invalidRequest("a close step requires a reason") };
    }
    if (r.closeReason.length > DESCRIPTION_MAX) {
      return { ok: false, error: invalidRequest(`closeReason may be at most ${DESCRIPTION_MAX} characters`) };
    }
    closeReason = r.closeReason.trim();
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
      effort: stepEffort,
      closeReason,
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
  };
}

// --- a spec that does not exist yet (spec 93) -------------------------------

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

// A field a person actually types into the New-spec form (REQ-2, spec
// 352): its resolution names the form, not the raw-request wording
// `invalidRequest()` gives the rest of this file — a title over
// `TITLE_MAX` is a real reader who typed too much, never a hand-crafted
// request.
const fixInTheForm = (what: string): string =>
  errorSentence({ what, resolve: "Fix it in the New spec form and submit again." }).text;

function text(raw: unknown, max: number, name: string, multiline = false): string | Error {
  if (typeof raw !== "string") return new Error(invalidRequest(`invalid ${name}`));
  const value = raw.replace(/\r\n?/g, "\n").trim();
  if (!value) return new Error(fixInTheForm(`${name} is required`));
  if (value.length > max) return new Error(fixInTheForm(`${name} is too long (max ${max})`));
  if (CONTROL_CHARS.test(value)) return new Error(fixInTheForm(`${name} contains control characters`));
  if (!multiline && value.includes("\n")) return new Error(fixInTheForm(`${name} must be one line`));
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
    return { ok: false, error: invalidRequest("body is not an object") };
  }
  const r = raw as Record<string, unknown>;
  const { defaults } = opts;

  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, error: invalidRequest("invalid project") };
  if (!opts.allow(r.project)) return { ok: false, error: invalidRequest(`unknown or not-allowed project: ${r.project}`) };

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
    if (!Array.isArray(r.dependsOn)) return { ok: false, error: invalidRequest("dependsOn must be a list") };
    if (r.dependsOn.length > 20) return { ok: false, error: invalidRequest("dependsOn: at most 20") };
    // No resolver, no known specs: a caller that never looks anything up
    // cannot name a dependency, which is the right answer for a call
    // site that does not carry the field at all.
    const known = new Set(opts.resolve?.(r.project)?.specFolders ?? []);
    for (const d of r.dependsOn) {
      if (typeof d !== "string" || !FOLDER_RE.test(d) || !known.has(d)) {
        return { ok: false, error: invalidRequest(`unknown spec in dependsOn: ${String(d)}`) };
      }
      if (dependsOn.includes(d)) return { ok: false, error: invalidRequest(`dependsOn repeats ${d}`) };
      dependsOn.push(d);
    }
  }

  // Which phases this job runs, beyond `create` itself (spec 342). The
  // New spec page's own phase table posts the same repeated `steps`
  // field the Specs list's row does, bounded to the same three phases
  // that row may tick (`PHASE_STEPS`) — never `create` a second time,
  // and never a step outside the workflow's own vocabulary. Omitted
  // entirely, an untouched form's `steps` is exactly `["create"]`,
  // identical to today's behaviour (REQ-3).
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

  // Which model each of those steps is run ON (spec 228, widened by
  // spec 342). Every step BUT `create` could already be pointed at one
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
  if (r.model !== undefined && r.model !== null && r.model !== "") {
    if (typeof r.model !== "object" || Array.isArray(r.model)) return { ok: false, error: invalidRequest("invalid model") };
    // Only the steps this job runs. A name posted for a step it does
    // not have is skipped rather than refused — the rule
    // `parseJobRequest` already follows for the same reason: a browser
    // posts every select it drew, whichever boxes are ticked.
    for (const [step, name] of Object.entries(r.model as Record<string, unknown>)) {
      if (name === undefined || name === null || name === "") continue;
      if (!steps.includes(step as WorkflowStep)) continue;
      if (typeof name !== "string" || !NAME_RE.test(name)) return { ok: false, error: invalidRequest(`invalid model for ${step}`) };
      const found = lookUpModel(defaults, name);
      if ("error" in found) return { ok: false, error: found.error };
      stepModels[step] = name;
    }
  }

  // Whether this run says acceptance ticking is not required (spec
  // 386) — the same whole-job checkbox `parseJobRequest` parses, so
  // the New-spec page and a spec row's Run form agree on the shape.
  // The form posts what it says: ticked means the ticking IS required.
  // A checkbox sends nothing when it is clear, so absent is "not
  // required" — the one asymmetry HTML forces, and the only place it
  // has to be thought about.
  const acceptanceRequired = r.acceptanceRequired === "1" || r.acceptanceRequired === true;

  // Whether AI formulates this create's acceptance criteria at all (spec
  // 433) — the same checked-by-default, posts-when-ticked shape as
  // `acceptanceRequired` above, inverted onto the job the same way.
  const aiFormulateAcceptance = r.aiFormulateAcceptance === "1" || r.aiFormulateAcceptance === true;

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
      // The config's own default for every step this job runs,
      // overridden per step by whatever was actually posted.
      model: { ...perStep(steps, defaults.model), ...stepModels },
      createTitle: title,
      createDescription: description,
      // Omitted entirely when nothing was chosen: "nothing chosen means
      // no line", all the way down.
      ...(dependsOn.length ? { createDependsOn: dependsOn } : {}),
      ...(acceptanceRequired ? {} : { acceptanceNotRequired: true }),
      ...(aiFormulateAcceptance ? {} : { createNoAiFormulate: true }),
      createdAt: new Date().toISOString(),
      results: [],
      spentUsd: 0,
    },
  };
}
