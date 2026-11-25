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

import { parseCreateChoices } from "./create-choices.ts";
import { parseProviderPick } from "./providers/parse.ts";
import type { CreateProjectAllower, Job, ProjectResolver, QueueDefaults } from "./types.ts";
import type { WorkflowStep } from "./steps.ts";
import { newProvisionalKey } from "../project/spec-names.ts";
import { PICK_PARTS } from "./providers/side-tools.ts";

import {
  archiveOnlyRefusal, createDependsOn, createModels, createSteps, DESCRIPTION_MAX, FOLDER_RE, isRefusal, jobCloseReason, jobEffort,
  jobGroupFields, jobModels, jobSteps, jobTarget, jobTimeouts, NAME_RE, perStep, text, TITLE_MAX,
} from "./request/fields.ts";

export {
  CLOSE_REASON_MAX, DESCRIPTION_MAX, FOLDER_RE, lookUpModel, NAME_RE, perStep, TITLE_MAX,
} from "./request/fields.ts";

export type ParseResult = { ok: true; job: Job } | ({ ok: false } & RequestRefusal);

import { fixInTheForm, invalidRequest, projectHidden, type RequestRefusal } from "../format/request-fixes.ts";
export { invalidRequest } from "../format/request-fixes.ts";


/** Unknown keys are ignored rather than refused.
 *
 *  `gateAfter` (a list of steps to stop after) is an unknown key, and
 *  unknown keys are ignored rather than refused (see the header): the
 *  three jobs that ever carried one were posted as JSON by hand, and
 *  refusing the field would turn a retired feature into a new error.
 *
 *  `extraProjects` was parsed here — passenger repos a run would also
 *  branch, commit and push, named on the row by a tick box per project.
 *  The box went when 0 of the queue's 200 jobs turned out to have used
 *  one, and the field went with it. Like `gateAfter` above it is an
 *  unknown key now, ignored rather than refused, so the jobs that
 *  carry one still load.
 *
 *  `acceptanceNotRequired` is not parsed: the choice is recorded on the
 *  spec itself (`specAcceptanceNotRequired`, read fresh at spawn time),
 *  so a second job for an existing spec has nothing left to post. Like
 *  `gateAfter` above it is an unknown key, ignored rather than refused.
 */
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
  if (!resolved || resolved.hidden) return { ok: false, ...(resolved ? projectHidden(r.project) : invalidRequest(`unknown or not-allowed project: ${r.project}`)) };

  if (typeof r.specFolder !== "string" || !FOLDER_RE.test(r.specFolder)) {
    return { ok: false, ...invalidRequest("invalid specFolder") };
  }
  const target = jobTarget(r as typeof r & { project: string; specFolder: string }, resolved);
  if (isRefusal(target)) return target;
  const { isLand, archivedOnly } = target;
  const steps = jobSteps(r, target);
  if (isRefusal(steps)) return steps;
  const archiveRefused = archiveOnlyRefusal({ project: r.project, specFolder: r.specFolder }, resolved, steps, archivedOnly);
  if (archiveRefused) return archiveRefused;
  const models = jobModels(r, steps, defaults);
  if (isRefusal(models)) return models;
  const { modelChoice, stepModels } = models;
  const jobModel: Record<string, string> = modelChoice
    ? Object.fromEntries(steps.map((s) => [s, modelChoice]))
    : { ...perStep(steps, defaults.model), ...stepModels };
  const picked = parseProviderPick(r.provider, steps, jobModel, defaults, undefined, PICK_PARTS);
  if ("error" in picked) return { ok: false, ...picked };

  const stepEffort = jobEffort(r, steps);
  if (isRefusal(stepEffort)) return stepEffort;
  const close = jobCloseReason(r, steps);
  if (isRefusal(close)) return close;
  const { closeReason } = close;

  // Whether a reopen also resets the three files. Only a job that
  // is exactly one `reopen` step can carry it.
  const resetFiles =
    steps.length === 1 && steps[0] === "reopen" &&
    (r.resetFiles === true || r.resetFiles === "1" || r.resetFiles === "on");
  const group = jobGroupFields(r as typeof r & { specFolder: string }, steps);
  if (isRefusal(group)) return group;
  const { executionGroupId, groupMembers, groupBranch } = group;

  const timeoutSec = jobTimeouts(r, steps, defaults);
  if (isRefusal(timeoutSec)) return timeoutSec;

  return {
    ok: true,
    job: queuedJob(r as typeof r & { project: string; specFolder: string }, steps, defaults, {
      jobModel, provider: picked.provider, modelChoice, stepEffort, closeReason, isLand, resetFiles, timeoutSec,
      executionGroupId, groupMembers, groupBranch,
    }),
  };
}

/** The job a run request makes, queued, from its checked fields. */
function queuedJob(
  r: Record<string, unknown> & { project: string; specFolder: string }, steps: WorkflowStep[], defaults: QueueDefaults,
  f: {
    jobModel: Record<string, string>; provider: Record<string, string>; modelChoice?: string; stepEffort: Record<string, string>;
    closeReason?: string; isLand: boolean; resetFiles: boolean; timeoutSec: Record<string, number>;
    executionGroupId?: string; groupMembers?: string[]; groupBranch?: string;
  },
): Job {
  return {
    id: crypto.randomUUID(),
    executionGroupId: f.executionGroupId, project: r.project,
    specFolder: r.specFolder,
    groupMembers: f.groupMembers,
    groupBranch: f.groupBranch,
    steps,
    stepIndex: 0,
    state: "queued",
    timeoutSec: f.timeoutSec,
    permissionMode: perStep(steps, defaults.permissionMode),
    // A whole-job pick applies to EVERY step: "reserve the heavy
    // model for the heavy job" is a decision about the job. A
    // per-step map overrides only the steps it names, and every
    // other step keeps the config's own choice.
    model: f.jobModel,
    ...(Object.keys(f.provider).length ? { provider: f.provider } : {}),
    // Left unset for a per-step map: it means "one model for the
    // whole job", which is no longer true once the steps may differ.
    modelChoice: f.modelChoice,
    effort: f.stepEffort,
    closeReason: f.closeReason,
    ...(f.isLand ? { branch: r.branch as string } : {}),
    ...(f.resetFiles ? { resetFiles: true } : {}),
    createdAt: new Date().toISOString(),
    results: [],
    spentUsd: 0,
  };
}

// --- a spec that does not exist yet -------------------------------

export type CreateParseResult = ParseResult & {
  create?: { project: string; title: string; description: string; dependsOn: string[];
    acceptanceRequired: boolean; criteriaChecks?: string; chooseApproach: boolean };
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

  if (r.project === undefined || r.project === null || r.project === "") {
    return { ok: false, ...fixInTheForm("project is required") };
  }
  if (typeof r.project !== "string" || !NAME_RE.test(r.project)) return { ok: false, ...invalidRequest("invalid project") };
  if (!opts.allow(r.project)) return { ok: false, ...invalidRequest(`unknown or not-allowed project: ${r.project}`) };
  if (opts.resolve?.(r.project)?.hidden) return { ok: false, ...projectHidden(r.project) };

  const title = text(r.title, TITLE_MAX, "title");
  if (title instanceof Error) return { ok: false, error: title.message, solution: title.solution };
  const description = text(r.description, DESCRIPTION_MAX, "description", true);
  if (description instanceof Error) return { ok: false, error: description.message, solution: description.solution };

  const dependsOn = createDependsOn(r as typeof r & { project: string }, opts.resolve);
  if (isRefusal(dependsOn)) return dependsOn;
  const steps = createSteps(r);
  if (isRefusal(steps)) return steps;
  const models = createModels(r, steps, defaults);
  if (isRefusal(models)) return models;
  const { stepModels, pendingStepModels } = models;

  const createModel = { ...perStep(steps, defaults.model), ...stepModels };
  const picked = parseProviderPick(r.provider, steps, createModel, defaults, pendingStepModels);
  if ("error" in picked) return { ok: false, ...picked };

  // The form's choices about the spec beyond its text (create-choices.ts).
  const choices = parseCreateChoices(r);
  if ("error" in choices) return { ok: false, ...invalidRequest(choices.error) };

  return {
    ok: true,
    create: {
      project: r.project,
      title,
      description,
      dependsOn,
      acceptanceRequired: !choices.fields.acceptanceNotRequired,
      criteriaChecks: choices.fields.createCriteriaChecks,
      chooseApproach: choices.fields.createChooseApproach ?? false,
    },
    job: queuedCreateJob(r.project, steps, defaults, { createModel, provider: picked.provider, title, description, dependsOn, choices: choices.fields }),
    ...(Object.keys(pendingStepModels).length ? { pendingStepModels } : {}),
    ...(Object.keys(picked.pending).length ? { pendingStepProviders: picked.pending } : {}),
  };
}

/** The `create` job a New spec request makes, queued. */
function queuedCreateJob(
  project: string, steps: WorkflowStep[], defaults: QueueDefaults,
  f: { createModel: Record<string, string>; provider: Record<string, string>; title: string; description: string; dependsOn: string[];
    choices: Extract<ReturnType<typeof parseCreateChoices>, { fields: unknown }>["fields"] },
): Job {
  return {
    id: crypto.randomUUID(),
    project,
    specFolder: newProvisionalKey(),
    steps,
    stepIndex: 0,
    state: "queued",
    timeoutSec: defaults.timeoutSec,
    permissionMode: perStep(steps, defaults.permissionMode),
    // The config's own default for every step this job runs,
    // overridden per step by whatever was actually posted.
    model: f.createModel,
    ...(Object.keys(f.provider).length ? { provider: f.provider } : {}),
    createTitle: f.title,
    createDescription: f.description,
    // Omitted entirely when nothing was chosen: "nothing chosen means
    // no line", all the way down.
    ...(f.dependsOn.length ? { createDependsOn: f.dependsOn } : {}),
    ...f.choices,
    createdAt: new Date().toISOString(),
    results: [],
    spentUsd: 0,
  };
}
