// `POST /api/queue/projects/<name>/models`: a project's Models per phase
// card. The card posts every row: a step with a model is the project's own
// choice, and a step left on Board default (no model, or an empty one) has
// the project's choice removed. Saved in the board's queue-config.json like
// every Settings save, so nothing in the project's repository changes.

import { listedModelName } from "../../../queue/model-name.ts";
import { providerKeyFrom, providerModelError } from "../../../queue/providers/parse.ts";
import { PICK_PARTS } from "../../../queue/providers/side-tools.ts";
import { SETTINGS_STEPS } from "../../../render";
import { json, readObjectBody } from "../../serve-helpers";
import type { RoutesContext } from "../index.ts";
import { saveQueueSettings } from "./index.ts";

const ROUTE = /^\/api\/queue\/projects\/([^/]+)\/models$/;

/** Every row the card draws, the steps and the parts beside them. */
const ROWS: readonly string[] = [...SETTINGS_STEPS, ...PICK_PARTS];

const table = (v: unknown): Record<string, unknown> | null =>
  v === undefined ? {} : v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export async function handleProjectModelsRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(ROUTE);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const refuse = (error: string) => json({ error }, 400);
  const name = decodeURIComponent(match[1]!);
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  if (!ctx.allowed.has(name)) return refuse(`unknown project: ${name}`);

  const asked = sent.body;
  const models = table(asked.model);
  const providers = table(asked.provider);
  if (!models) return refuse("model choices are malformed");
  if (!providers) return refuse("provider choices are malformed");
  const unknown = [...Object.keys(models), ...Object.keys(providers)].find((step) => !ROWS.includes(step));
  if (unknown) return refuse(`unknown workflow step: ${unknown}`);

  const defaults = ctx.queue.defaults;
  const model: Record<string, string | null> = {};
  const provider: Record<string, string | null> = {};
  for (const step of ROWS) {
    const value = models[step];
    if (Array.isArray(value)) return refuse(`duplicate model value for ${step}`);
    if (value !== undefined && typeof value !== "string") return refuse(`invalid model for ${step}`);
    // Board default: the project's choice for the step goes, AI included.
    if (!value) { model[step] = null; provider[step] = null; continue; }
    const listed = listedModelName(Object.keys(defaults.modelChoices ?? {}), value);
    if ("candidates" in listed) {
      const hint = listed.candidates.length ? ` (listed as ${listed.candidates.join(" or ")})` : "";
      return refuse(`unknown or not-allowed model for ${step}: ${value}${hint}`);
    }
    model[step] = listed.name;
    const askedProvider = providers[step];
    if (askedProvider === undefined || askedProvider === "") { provider[step] = null; continue; }
    const found = providerKeyFrom(defaults, askedProvider, ` for ${step}`);
    if ("error" in found) return refuse(found.error);
    const mismatch = providerModelError(defaults, found.key, listed.name);
    if (mismatch) return refuse(mismatch.error);
    provider[step] = found.key;
  }
  const error = saveQueueSettings(ctx, { projectModels: { [name]: { model, provider } } });
  if (error) return refuse(error);
  return json({ ok: true });
}
