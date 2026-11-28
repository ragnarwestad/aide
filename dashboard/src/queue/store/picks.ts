// The picks that are not a press: the model and provider chosen for a step
// of a running job that has not been reached yet, and for a phase that has
// no job yet. Each is checked where a request is — the name against the
// configured choices, the provider against the configured providers, the
// model against what the provider runs.

import { invalidRequest, lookUpModel, NAME_RE, type ParseResult } from "../parse-request.ts";
import { providerKeyFrom, providerModelError } from "../providers/parse.ts";
import { runsModel } from "../providers/index.ts";
import { WORKFLOW_STEPS } from "../steps.ts";
import type { Job, QueueDefaults } from "../types.ts";
import { tailEditStep } from "./tail-edits.ts";
import type { PendingModelResult } from "./types.ts";
import { PICK_PARTS } from "../providers/side-tools.ts";
import type { RequestRefusal } from "../../format/request-fixes.ts";

/** What the picks read and write, handed over by the store. */
export interface PickContext {
  jobs: Map<string, Job>;
  defaults: QueueDefaults;
  /** `project/specFolder` → step → model, and the same for the provider. */
  pendingModels: Record<string, Record<string, string>>;
  pendingProviders: Record<string, Record<string, string>>;
  /** Writes both pending tables as given; the refusal when they are not on disk. */
  save: (models: Record<string, Record<string, string>>, providers: Record<string, Record<string, string>>) => RequestRefusal | undefined;
  mirror: () => void;
  changed: () => void;
}

/** The refusal for `provider` with `model`, or the key it names. */
function checkedProvider(defaults: QueueDefaults, provider: string, model: string): { key: string } | RequestRefusal {
  const found = providerKeyFrom(defaults, provider, "");
  if ("error" in found) return found;
  const refusal = providerModelError(defaults, found.key, model);
  return refusal ?? found;
}

/** Change the model a RUNNING job will use for a step it has not reached
 *  yet, and the provider with it — the AI and model selects beside the
 *  boxes a running job leaves editable.
 *
 *  Guarded by the SAME `tailEdits()` the box's own route asks, so a select
 *  drawn live and the store that takes its pick can never disagree about
 *  where the tail starts. It answers for both kinds of step that function
 *  names without a branch between them: one already in the job's tail, and
 *  one the job does not have at all — `Job.model` is a per-step table, and
 *  an entry for a step nobody has ticked is inert until the step is added
 *  and reached.
 *
 *  Read, checked and written in ONE synchronous call, nothing awaited in
 *  between: that is what makes a pick arriving after its step has started
 *  find it outside `tailEdits()` and be refused by name, rather than land
 *  too late and silently. A provider that cannot run the model is refused;
 *  with no provider posted, the step's own pick is dropped when it cannot
 *  run the new model. */
export function editTailModel(ctx: PickContext, id: string, step: string, model: string, provider?: string): ParseResult {
  const job = ctx.jobs.get(id);
  if (!job) return { ok: false, ...invalidRequest("no such job") };
  const editable = tailEditStep(job, step);
  if ("error" in editable) return { ok: false, ...editable };
  const wanted = editable.step;
  if (!NAME_RE.test(model)) return { ok: false, ...invalidRequest("invalid model") };
  const found = lookUpModel(ctx.defaults, model);
  if ("error" in found) return { ok: false, ...found };
  let providers = job.provider;
  if (provider) {
    const checked = checkedProvider(ctx.defaults, provider, found.name);
    if ("error" in checked) return { ok: false, ...checked };
    providers = { ...providers, [wanted]: checked.key };
  } else if (providers?.[wanted]) {
    const own = ctx.defaults.providers?.[providers[wanted]!];
    if (own && !runsModel(own, ctx.defaults.modelChoices?.[found.name])) {
      const { [wanted]: _dropped, ...rest } = providers;
      providers = rest;
    }
  }
  const next: Job = { ...job, model: { ...job.model, [wanted]: found.name }, ...(providers ? { provider: providers } : {}) };
  ctx.jobs.set(id, next);
  ctx.mirror();
  ctx.changed();
  return { ok: true, job: next };
}

type Table = Record<string, Record<string, string>>;

/** Saves the next tables, and only then makes them what the store holds:
 *  a pick that did not reach the file leaves memory as it was. */
function commit(ctx: PickContext, models: Table, providers: Table): RequestRefusal | undefined {
  const refused = ctx.save(models, providers);
  if (!refused) keep(ctx, models, providers);
  return refused;
}

function keep(ctx: PickContext, models: Table, providers: Table): void {
  for (const [table, next] of [[ctx.pendingModels, models], [ctx.pendingProviders, providers]] as const) {
    for (const key of Object.keys(table)) delete table[key];
    Object.assign(table, next);
  }
}

/** The write `setPendingModel()` and a create's own seeding share, without
 *  either one's own `changed()` call: a create folds this into the ONE
 *  insert-and-seed operation it is, and `insert()` has already announced
 *  that. */
export function writePendingModel(
  ctx: PickContext, project: string, specFolder: string, step: string, model: string, provider?: string,
): RequestRefusal | undefined {
  const key = `${project}/${specFolder}`;
  const models = { ...ctx.pendingModels, [key]: { ...ctx.pendingModels[key], [step]: model } };
  const providers = provider ? { ...ctx.pendingProviders, [key]: { ...ctx.pendingProviders[key], [step]: provider } } : ctx.pendingProviders;
  return commit(ctx, models, { ...providers });
}

function clearPendingModel(ctx: PickContext, project: string, specFolder: string, step: string): RequestRefusal | undefined {
  const record = `${project}/${specFolder}`;
  const [models, providers] = [ctx.pendingModels, ctx.pendingProviders].map((table) => {
    const next = { ...table };
    if (!next[record]) return next;
    const { [step]: _removed, ...rest } = next[record]!;
    if (Object.keys(rest).length) next[record] = rest;
    else delete next[record];
    return next;
  });
  return commit(ctx, models!, providers!);
}

/** Record a model, and the provider, picked for a phase that has no job
 *  yet — the pre-job sibling of `editTailModel()`, checked the same way:
 *  the step against `WORKFLOW_STEPS`, the model against the configured
 *  allowlist, the provider against what it can run. There is no
 *  `job.state` to gate on, since there is no job at all. */
export function setPendingModel(
  ctx: PickContext, project: string, specFolder: string, step: string, model: string, provider?: string,
): PendingModelResult {
  const wanted = [...WORKFLOW_STEPS, ...PICK_PARTS].find((s) => s === step);
  if (!wanted) return { ok: false, ...invalidRequest(`${step || "that step"} is not a step a model can be chosen for`) };
  if ((PICK_PARTS as readonly string[]).includes(wanted) && model === "") {
    const refused = clearPendingModel(ctx, project, specFolder, wanted);
    if (refused) return { ok: false, ...refused };
    ctx.changed();
    return { ok: true };
  }
  if (!NAME_RE.test(model)) return { ok: false, ...invalidRequest("invalid model") };
  const found = lookUpModel(ctx.defaults, model);
  if ("error" in found) return { ok: false, ...found };
  let key: string | undefined;
  if (provider) {
    const checked = checkedProvider(ctx.defaults, provider, found.name);
    if ("error" in checked) return { ok: false, ...checked };
    key = checked.key;
  }
  const refused = writePendingModel(ctx, project, specFolder, wanted, found.name, key);
  if (refused) return { ok: false, ...refused };
  ctx.changed();
  return { ok: true };
}

/** Carries a create job's pending picks from its provisional key to the
 *  real folder landing assigns it. A no-op when nothing is recorded under
 *  the provisional key, which is the common case: most picks are for a
 *  phase the create job DOES run and never touch these tables. */
export function renamePendingModel(ctx: PickContext, project: string, fromFolder: string, toFolder: string): RequestRefusal | undefined {
  const fromKey = `${project}/${fromFolder}`;
  const toKey = `${project}/${toFolder}`;
  if (!ctx.pendingModels[fromKey] && !ctx.pendingProviders[fromKey]) return undefined;
  const [models, providers] = [ctx.pendingModels, ctx.pendingProviders].map((table) => {
    const { [fromKey]: moved, ...rest } = table;
    return moved ? { ...rest, [toKey]: moved } : rest;
  });
  // The landing that asks for this has already happened and moves the
  // job's folder whatever the answer, so the picks move with it in memory
  // even when the file could not take the change; the fault is reported.
  const refused = ctx.save(models!, providers!);
  keep(ctx, models!, providers!);
  ctx.changed();
  return refused;
}
