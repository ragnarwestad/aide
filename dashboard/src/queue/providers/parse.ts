// Reading the provider a request picks: for the whole job as one key, or per
// step as an object, the way `model` is posted. Here rather than in
// `parse-request.ts`, which is near its size limit.

import { invalidRequest, NAME_RE } from "../parse-request.ts";
import { listedModelName } from "../model-name.ts";
import { PHASE_STEPS } from "../steps.ts";
import type { QueueDefaults } from "../types.ts";
import type { RequestRefusal } from "../../format/request-fixes.ts";
import { runsModel } from "./index.ts";
import { TOOLS, providerFamily } from "./tools.ts";

type Defaults = Pick<QueueDefaults, "modelChoices" | "providers">;

/** The refusal when `model` is not one `key`'s provider can run, or null.
 *  A model no choice lists is left to the model's own check. */
export function providerModelError(defaults: Defaults, key: string, model: string | undefined): RequestRefusal | null {
  const provider = defaults.providers?.[key];
  if (!provider) return invalidRequest(`unknown or not-allowed provider: ${key}`);
  const listed = model && defaults.modelChoices ? listedModelName(Object.keys(defaults.modelChoices), model) : undefined;
  if (!model || !listed || !("name" in listed)) return null;
  const choice = defaults.modelChoices?.[listed.name];
  if (runsModel(provider, choice)) return null;
  return invalidRequest(
    `${model} is a ${TOOLS[providerFamily(choice?.tool ?? "claude")].name} model and ${provider.name} is a ${TOOLS[provider.tool].name} provider — pick a model under it`,
  );
}

/** A key off a request: a configured provider's, or the refusal. */
export function providerKeyFrom(defaults: Defaults, value: unknown, what: string): { key: string } | RequestRefusal {
  if (typeof value !== "string" || !NAME_RE.test(value)) return invalidRequest(`invalid provider${what}`);
  if (!defaults.providers?.[value]) return invalidRequest(`unknown or not-allowed provider: ${value}`);
  return { key: value };
}

/** The provider a request picks for each step it runs, and — when
 *  `allowPending` — for each phase it does not run yet. `models` is the
 *  model each running step is given; a provider that cannot run it is
 *  refused. Blank entries, and steps the job does not run, are skipped as
 *  `model`'s are. */
export function parseProviderPick(
  raw: unknown,
  steps: readonly string[],
  models: Record<string, string>,
  defaults: Defaults,
  pendingModels?: Record<string, string>,
): { provider: Record<string, string>; pending: Record<string, string> } | RequestRefusal {
  const provider: Record<string, string> = {};
  const pending: Record<string, string> = {};
  if (raw === undefined || raw === null || raw === "") return { provider, pending };
  if (typeof raw !== "string" && (typeof raw !== "object" || Array.isArray(raw))) return invalidRequest("invalid provider");
  const picks: [string, unknown][] = typeof raw === "string" ? steps.map((s) => [s, raw]) : Object.entries(raw);
  for (const [step, value] of picks) {
    if (value === undefined || value === null || value === "") continue;
    const runsNow = steps.includes(step);
    if (!runsNow && !(pendingModels && (PHASE_STEPS as readonly string[]).includes(step))) continue;
    const found = providerKeyFrom(defaults, value, ` for ${step}`);
    if ("error" in found) return found;
    const refusal = providerModelError(defaults, found.key, runsNow ? models[step] : pendingModels?.[step]);
    if (refusal) return refusal;
    (runsNow ? provider : pending)[step] = found.key;
  }
  return { provider, pending };
}
