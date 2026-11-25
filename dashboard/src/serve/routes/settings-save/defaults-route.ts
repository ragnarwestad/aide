// The Settings page's Phases form: each phase's model, provider and time
// limit, saved as the queue's defaults.

import { listedModelName } from "../../../queue/model-name.ts";
import { providerKeyFrom, providerModelError } from "../../../queue/providers/parse.ts";
import { SETTINGS_STEPS } from "../../../render";
import { PICK_PARTS, PLAN_REVIEW, planReviewToSave } from "../../../queue/providers/side-tools.ts";
import { json, readObjectBody } from "../../serve-helpers";
import type { RoutesContext } from "../";
import { saveQueueSettings } from "./index.ts";

type Refused = { error: string };
const refused = (x: unknown): x is Refused => typeof x === "object" && x !== null && "error" in x;
const knownSettings = [...SETTINGS_STEPS, ...PICK_PARTS] as readonly string[];

/** Each phase's model, by the name the queue's model choices list it under. */
function phaseModels(ctx: RoutesContext, table: Record<string, unknown>): Record<string, string> | Refused {
  const next: Record<string, string> = {};
  for (const step of SETTINGS_STEPS) {
    const value = table[step];
    if (Array.isArray(value)) return refusedWith(`duplicate model value for ${step}`);
    if (typeof value !== "string" || !value) return refusedWith(`missing model for ${step}`);
    const listed = listedModelName(Object.keys(ctx.queue.defaults.modelChoices ?? {}), value);
    if ("candidates" in listed) {
      const hint = listed.candidates.length ? ` (listed as ${listed.candidates.join(" or ")})` : "";
      return refusedWith(`unknown or not-allowed model for ${step}: ${value}${hint}`);
    }
    next[step] = listed.name;
  }
  return next;
}

/** The side parts' models; an empty one clears the part's own choice. */
function sideModelsFrom(ctx: RoutesContext, table: Record<string, unknown>): Record<string, string | null> | Refused {
  const sideModels: Record<string, string | null> = {};
  for (const part of PICK_PARTS) {
    const value = table[part];
    if (value === undefined) continue;
    if (Array.isArray(value) || typeof value !== "string") return refusedWith(`invalid model for ${part}`);
    if (!value) { sideModels[part] = null; continue; }
    const listed = listedModelName(Object.keys(ctx.queue.defaults.modelChoices ?? {}), value);
    if ("candidates" in listed) return refusedWith(`unknown or not-allowed model for ${part}: ${value}`);
    sideModels[part] = listed.name;
  }

  return sideModels;
}

function providersFrom(
  ctx: RoutesContext, providers: unknown, next: Record<string, string>, sideModels: Record<string, string | null>,
): Record<string, string | null> | Refused {
  // The provider each phase runs on, posted as `provider.<step>` beside
  // the model; a save that posts none leaves the defaults' providers as
  // they are. Each must be configured and run the model saved with it.
  const nextProvider: Record<string, string | null> = {};
  if (providers !== undefined && (providers === null || typeof providers !== "object" || Array.isArray(providers))) {
    return refusedWith("provider defaults are malformed");
  }
  for (const [step, value] of Object.entries((providers ?? {}) as Record<string, unknown>)) {
    if (!knownSettings.includes(step)) return refusedWith(`unknown workflow step: ${step}`);
    if (value === "" || value === undefined) continue;
    const found = providerKeyFrom(ctx.queue.defaults, value, ` for ${step}`);
    if ("error" in found) return refusedWith(found.error);
    const selectedModel = next[step] ?? sideModels[step];
    if (!selectedModel) continue;
    const refusal = providerModelError(ctx.queue.defaults, found.key, selectedModel);
    if (refusal) return refusedWith(refusal.error);
    nextProvider[step] = found.key;
  }
  return nextProvider;
}

function keepPlanReview(
  ctx: RoutesContext, next: Record<string, string>, sideModels: Record<string, string | null>, nextProvider: Record<string, string | null>,
): void {
  // Review under Analyze is saved only as a choice of its own: a pair that
  // follows Analyze, or a cleared model, removes both keys.
  const before = ctx.queue.defaults;
  const dropPlanReview = () => {
    sideModels[PLAN_REVIEW] = null;
    if (before.provider?.[PLAN_REVIEW] !== undefined) nextProvider[PLAN_REVIEW] = null;
    else delete nextProvider[PLAN_REVIEW];
  };
  const planReview = sideModels[PLAN_REVIEW];
  if (planReview === null) dropPlanReview();
  if (planReview) {
    const restedModel = before.model.analyze ?? before.model.default ?? "";
    const listedRested = listedModelName(Object.keys(before.modelChoices ?? {}), restedModel);
    const kept = planReviewToSave(
      { model: planReview, provider: nextProvider[PLAN_REVIEW] ?? undefined },
      { model: next.analyze ?? "", provider: nextProvider.analyze ?? undefined },
      { model: "name" in listedRested ? listedRested.name : restedModel, provider: before.provider?.analyze },
      before.model[PLAN_REVIEW] !== undefined,
    );
    if (!kept) dropPlanReview();
  }

}

function timeoutsFrom(asked: Record<string, unknown>): Record<string, number> | Refused {
  // timeoutSec: the ceiling a per-job request can only tighten
  // (`tighten()` above), never loosen — this range catches an
  // operator's typo.
  const numField = (v: unknown, name: string, min: number, max: number): number | { error: string } => {
    if (typeof v !== "number" || !Number.isFinite(v)) return { error: `invalid ${name}` };
    if (v < min || v > max) return { error: `${name} must be between ${min} and ${max}` };
    return v;
  };

  const askedTimeout = asked.timeoutSec;
  if (!askedTimeout || typeof askedTimeout !== "object" || Array.isArray(askedTimeout)) {
    return refusedWith("timeoutSec is missing");
  }
  const minutesTable = askedTimeout as Record<string, unknown>;
  const timeoutSec: Record<string, number> = {};
  for (const step of SETTINGS_STEPS) {
    // Minutes on this route (matching the form and the existing
    // render/job-state.ts:145 display convention) — converted to
    // seconds, the unit every reader of `queue.defaults.timeoutSec`
    // already expects.
    const minutes = numField(minutesTable[step], `timeoutSec.${step}`, 1, 360);
    if (typeof minutes !== "number") return refusedWith(minutes.error);
    timeoutSec[step] = minutes * 60;
  }

  return timeoutSec;
}

const refusedWith = (error: string): Refused => ({ error });

export async function queueDefaultsRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  if (path !== "/api/queue/settings") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const asked = sent.body;
  const models = asked.model;
  const refuse = (error: string) => json({ error }, 400);
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  if (!models || typeof models !== "object" || Array.isArray(models)) return refuse("model defaults are missing");
  const table = models as Record<string, unknown>;
  const unknown = Object.keys(table).find((step) => !knownSettings.includes(step));
  if (unknown) return refuse(`unknown workflow step: ${unknown}`);
  const next = phaseModels(ctx, table);
  if (refused(next)) return refuse(next.error);
  const sideModels = sideModelsFrom(ctx, table);
  if (refused(sideModels)) return refuse(sideModels.error);
  const nextProvider = providersFrom(ctx, asked.provider, next, sideModels);
  if (refused(nextProvider)) return refuse(nextProvider.error);
  keepPlanReview(ctx, next, sideModels, nextProvider);
  const timeoutSec = timeoutsFrom(asked);
  if (refused(timeoutSec)) return refuse(timeoutSec.error);
  const modelUpdate = { ...next, ...sideModels };
  const error = saveQueueSettings(ctx, { model: modelUpdate, timeoutSec, provider: nextProvider });
  if (error) return refuse(error);
  return json({ ok: true, model: next, timeoutSec });
}
