// An AI's Models tab under Settings → AI: adding a model it offers to the
// model choices, and removing a choice it no longer offers. The file is
// written first and the live choices changed only once the write
// succeeded, the order every Settings save follows; every page reads the
// live choices, so the next one drawn has the change.
//
// A model is added only when the last press of the Models tab's Check
// read it among what the AI offers.

import { persistQueueSettings, type QueueStore } from "../../queue/queue.ts";
import type { ModelChoice } from "../../queue/types.ts";
import { NAME_RE } from "../../queue/parse-request.ts";
import { listedModelName } from "../../queue/model-name.ts";
import { recordModelName } from "../../queue/store/model-ids.ts";
import { capitalizeFirst } from "../../format/error-sentence.ts";
import { stepLabel } from "../../format/step-label.ts";
import {
  choiceModel, choiceOf, MODELS_ADD_ROUTE, MODELS_REMOVE_ROUTE, sameModel, TOOL_TAB_LABELS, type ToolModels,
} from "../../render";
import { isClaudeFamily, lastModels } from "../tool-models";
import { bodyToObject, json, readBounded } from "../serve-helpers";
import type { RoutesContext } from "./";

type ModelTool = "claude" | "codex" | "opencode";
const isModelTool = (v: unknown): v is ModelTool => v === "claude" || v === "codex" || v === "opencode";

/** Records, for each Claude choice the reading names, the id Claude Code
 *  resolves it to — exactly as a run records the id it ran on, so the
 *  newest of the two is what every picker shows — and the name Claude Code
 *  gave it, which the pickers show while that id stands. */
export function recordClaudeVersions(
  queue: Pick<QueueStore, "defaults" | "modelIds">,
  models: ToolModels,
  modelIdsPath: string | undefined,
): void {
  if (models.tool !== "claude" || models.error) return;
  const read = [...models.offered, ...(models.named ?? [])];
  for (const [name, choice] of Object.entries(queue.defaults.modelChoices ?? {})) {
    if (!choiceOf("claude", choice)) continue;
    const found = read.find((m) => sameModel("claude", m.model, choiceModel(name, choice)));
    if (found?.id && found.name) recordModelName(modelIdsPath, queue.modelIds, name, found.id, found.name);
  }
}

/** The key a new choice is written under: a Claude family as the existing
 *  ones are written (`Haiku`), a Codex slug or Claude id as it is, an
 *  OpenCode model as the part after its provider, or `provider-model` when
 *  that is taken. Undefined when every candidate is taken. */
function keyFor(tool: ModelTool, model: string, taken: string[]): string | undefined {
  const clean = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
  const free = (key: string) => NAME_RE.test(key) && !taken.some((t) => t.toLowerCase() === key.toLowerCase());
  const candidates =
    tool === "claude" && isClaudeFamily(model) ? [capitalizeFirst(model.toLowerCase())]
      : tool === "opencode" && model.includes("/") ? [model.slice(model.indexOf("/") + 1), model]
        : [model];
  return candidates.map(clean).find(free);
}

async function parseBody(req: Request): Promise<Record<string, unknown> | Response> {
  const body = await readBounded(req);
  if ("refusal" in body) return body.refusal;
  try {
    return (bodyToObject(body.text, req.headers.get("content-type")) ?? {}) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed body" }, 400);
  }
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

async function addModel(ctx: RoutesContext, asked: Record<string, unknown>): Promise<Response> {
  const refuse = (error: string) => json({ error }, 400);
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const tool = asked.tool;
  if (!isModelTool(tool)) return refuse("unknown AI: models can be added for claude, codex and opencode");
  const model = text(asked.model);
  const ai = TOOL_TAB_LABELS[tool];
  if (!model) return refuse(`no model was named — pick one on the ${ai} tab`);
  const choices = ctx.queue.defaults.modelChoices ?? {};
  const already = Object.entries(choices).find(
    ([name, choice]) => choiceOf(tool, choice) && sameModel(tool, choiceModel(name, choice), model),
  );
  if (already) return refuse(`${model} is already a model choice for ${ai}, as ${already[0]} — nothing to add`);

  const reading = lastModels()[tool];
  const read = reading && !reading.error
    ? reading.offered.find((m) => sameModel(tool, m.model, model))
    : undefined;
  if (!read) {
    return refuse(`${model} is not among the models ${ai} offered when it was last read — press Check on the ${ai} tab's Models tab and try again`);
  }

  const key = keyFor(tool, model, Object.keys(choices));
  if (!key) return refuse(`another model choice already has the name ${model} — rename it in queue-config.json on the serving host first`);
  const entry: ModelChoice = tool === "claude" ? { model } : { tool, model };
  const error = persistQueueSettings(ctx.opts.queueConfigFile, { modelChoices: { [key]: entry } });
  if (error) return refuse(error);
  ctx.queue.defaults.modelChoices = { ...choices, [key]: entry };
  // The name Claude Code gave it is what it is shown by, kept with the id
  // it gave it for (the model itself when the reading named none).
  if (tool === "claude" && read.name) {
    recordModelName(ctx.opts.modelIdsPath, ctx.queue.modelIds, key, read.id ?? model, read.name);
  }
  return json({ ok: true, name: key });
}

/** Each step whose default model is `name`, as the refusal names it. */
function defaultFor(defaults: Record<string, string>, name: string): string[] {
  return Object.entries(defaults)
    .filter(([, value]) => value.toLowerCase() === name.toLowerCase())
    .map(([step]) => (step === "default" ? "every step without its own" : stepLabel(step)));
}

const listed = (words: string[]): string =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

function removeModel(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  const refuse = (error: string) => json({ error }, 400);
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const choices = ctx.queue.defaults.modelChoices ?? {};
  const match = listedModelName(Object.keys(choices), text(asked.name));
  if (!("name" in match)) return refuse(`${text(asked.name) || "That"} is not a model choice — nothing to remove`);
  const name = match.name;
  const steps = defaultFor(ctx.queue.defaults.model, name);
  if (steps.length) {
    return refuse(
      `${name} is the default model for ${listed(steps)}, so it cannot be removed — ` +
        "pick another model for them first under Models per phase, or, for a step with no row there, " +
        "in queue-config.json on the serving host",
    );
  }
  const error = persistQueueSettings(ctx.opts.queueConfigFile, { modelChoices: { [name]: null } });
  if (error) return refuse(error);
  const rest = Object.fromEntries(Object.entries(choices).filter(([key]) => key !== name));
  // Left empty, the table is absent, as the config reader leaves it.
  ctx.queue.defaults.modelChoices = Object.keys(rest).length ? rest : undefined;
  return json({ ok: true, name });
}

export async function handleSettingsModelsRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path !== MODELS_ADD_ROUTE && path !== MODELS_REMOVE_ROUTE) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const asked = await parseBody(req);
  if (asked instanceof Response) return asked;
  return path === MODELS_ADD_ROUTE ? addModel(ctx, asked) : removeModel(ctx, asked);
}
