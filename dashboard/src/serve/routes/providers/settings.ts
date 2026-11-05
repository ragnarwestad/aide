// Adding, editing, renaming and removing a provider from Settings → AI →
// Providers. The file is written first and the live providers changed only
// once the write succeeded, the order the model choices follow
// (`settings-models.ts`); a refusal changes neither.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { persistQueueSettings } from "../../../queue/queue.ts";
import {
  NORMAL_CLAUDE_DIR, NORMAL_CODEX_HOME, asProviderTool, expandDir, providerFields, providerNameError, providerUses,
  type Provider, type ProviderField,
} from "../../../queue/providers/index.ts";
import { PROVIDERS_ADD_ROUTE, PROVIDERS_EDIT_ROUTE, PROVIDERS_REMOVE_ROUTE, PROVIDERS_RENAME_ROUTE } from "../../../render";
import { bodyToObject, json, readBounded } from "../../serve-helpers";
import { prepareShadowHome } from "../../providers/shadow-home.ts";
import type { RoutesContext } from "../";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const refuse = (error: string): Response => json({ error }, 400);

async function parseBody(req: Request): Promise<Record<string, unknown> | Response> {
  const body = await readBounded(req);
  if ("refusal" in body) return body.refusal;
  try {
    return (bodyToObject(body.text, req.headers.get("content-type")) ?? {}) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed body" }, 400);
  }
}

/** The key whose name is this one, in any case. */
const nameTaken = (providers: Record<string, Provider>, name: string, except?: string): string | undefined =>
  Object.entries(providers).find(([key, p]) => key !== except && p.name.toLowerCase() === name.toLowerCase())?.[1].name;

/** A key no other provider holds: the name, else the first of `<name>-2`, `<name>-3` … */
function freeKey(providers: Record<string, Provider>, name: string): string {
  const held = new Set(Object.keys(providers).map((k) => k.toLowerCase()));
  let key = name;
  for (let n = 2; held.has(key.toLowerCase()); n++) {
    const suffix = `-${n}`;
    key = `${name.slice(0, 64 - suffix.length)}${suffix}`;
  }
  return key;
}

/** The folder a provider's login lives in, expanded: what two providers of
 *  one tool must not share. */
function loginOf(provider: Provider, home: string): string {
  if (provider.tool === "claude") return expandDir(provider.configDir || NORMAL_CLAUDE_DIR, home);
  if (provider.tool === "codex") return expandDir(provider.shadowHome || provider.codexHome || NORMAL_CODEX_HOME, home);
  return "opencode";
}

/** The fields a tool has, read off the body and checked: written from `/`
 *  or `~/`, and a login folder that is there. */
function readFields(tool: Provider["tool"], asked: Record<string, unknown>, home: string): Partial<Provider> | string {
  const out: Partial<Provider> = {};
  for (const field of providerFields(tool) as ProviderField[]) {
    const raw = text(asked[field]);
    if (!raw) continue;
    const dir = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
    if (!dir.startsWith("/") && !dir.startsWith("~/")) return `The folder must be written from / or ~/ — ${dir} was given`;
    const expanded = expandDir(dir, home);
    if (field !== "shadowHome" && (!existsSync(expanded) || !statSync(expanded).isDirectory())) {
      return `${dir} does not exist on the serving host — make the folder and log in there first (running-specs.md says how)`;
    }
    out[field] = dir;
  }
  return out;
}

/** Why this provider cannot be saved next to the others, or null: a login
 *  another provider of the tool already uses, and a shadow home that cannot
 *  be prepared (which prepares it). */
function conflict(providers: Record<string, Provider>, key: string | undefined, provider: Provider, home: string): string | null {
  const login = loginOf(provider, home);
  const taken = Object.entries(providers).find(([k, p]) => k !== key && p.tool === provider.tool && loginOf(p, home) === login);
  if (taken) {
    return provider.tool === "opencode"
      ? `OpenCode has one login on the serving host and ${taken[1].name} already uses it — there is only one OpenCode provider`
      : `${taken[1].name} already logs in under ${login} — give this provider a folder of its own`;
  }
  if (provider.tool === "codex" && provider.shadowHome) {
    return prepareShadowHome(expandDir(provider.codexHome || NORMAL_CODEX_HOME, home), expandDir(provider.shadowHome, home));
  }
  return null;
}

function save(ctx: RoutesContext, key: string, provider: Provider, extra: Record<string, unknown> = {}): Response {
  const error = persistQueueSettings(ctx.opts.queueConfigFile!, { providers: { [key]: provider } });
  if (error) return refuse(error);
  ctx.queue.defaults.providers = { ...ctx.queue.defaults.providers, [key]: provider };
  return json({ ok: true, key, ...extra });
}

function addProvider(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  const providers = ctx.queue.defaults.providers ?? {};
  const tool = asProviderTool(asked.tool);
  if (!tool) return refuse("Choose the tool the provider is for: Claude Code, Codex or OpenCode");
  const name = text(asked.name);
  const bad = providerNameError(name);
  if (bad) return refuse(bad);
  const taken = nameTaken(providers, name);
  if (taken) return refuse(`${taken} is already a provider — pick another name, or rename that one`);
  const home = homedir();
  const fields = readFields(tool, asked, home);
  if (typeof fields === "string") return refuse(fields);
  const provider: Provider = { name, tool, ...fields };
  const clash = conflict(providers, undefined, provider, home);
  if (clash) return refuse(clash);
  return save(ctx, freeKey(providers, name), provider, { name });
}

function editProvider(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  const providers = ctx.queue.defaults.providers ?? {};
  const key = text(asked.key);
  const current = providers[key];
  if (!current) return refuse(`${key || "That"} is not a provider — nothing to edit`);
  const home = homedir();
  const fields = readFields(current.tool, asked, home);
  if (typeof fields === "string") return refuse(fields);
  const provider: Provider = { name: current.name, tool: current.tool, ...fields };
  const clash = conflict(providers, key, provider, home);
  if (clash) return refuse(clash);
  return save(ctx, key, provider);
}

function renameProvider(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  const providers = ctx.queue.defaults.providers ?? {};
  const key = text(asked.key);
  const current = providers[key];
  if (!current) return refuse(`${key || "That"} is not a provider — nothing to rename`);
  const newName = text(asked.newName);
  const bad = providerNameError(newName);
  if (bad) return refuse(bad);
  const taken = nameTaken(providers, newName, key);
  if (taken) return refuse(`${taken} is already a provider — pick another name`);
  return save(ctx, key, { ...current, name: newName }, { name: newName });
}

function removeProvider(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  const providers = ctx.queue.defaults.providers ?? {};
  const key = text(asked.key);
  const current = providers[key];
  if (!current) return refuse(`${key || "That"} is not a provider — nothing to remove`);
  const schedules = Object.fromEntries([...ctx.allowed].map((project) => [project, ctx.scheduleStore.list(project)]));
  const uses = providerUses(key, ctx.queue.defaults, schedules, ctx.queue.list());
  if (uses.length) {
    return refuse(`${current.name} is in use and cannot be removed: ${uses.join(", ")} — choose another provider there first`);
  }
  const error = persistQueueSettings(ctx.opts.queueConfigFile!, { providers: { [key]: null } });
  if (error) return refuse(error);
  const { [key]: _gone, ...rest } = providers;
  ctx.queue.defaults.providers = rest;
  return json({ ok: true, key });
}

export async function handleProviderSettingsRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  if (
    path !== PROVIDERS_ADD_ROUTE && path !== PROVIDERS_EDIT_ROUTE && path !== PROVIDERS_RENAME_ROUTE &&
    path !== PROVIDERS_REMOVE_ROUTE
  ) {
    return null;
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const asked = await parseBody(req);
  if (asked instanceof Response) return asked;
  if (path === PROVIDERS_ADD_ROUTE) return addProvider(ctx, asked);
  if (path === PROVIDERS_EDIT_ROUTE) return editProvider(ctx, asked);
  return path === PROVIDERS_RENAME_ROUTE ? renameProvider(ctx, asked) : removeProvider(ctx, asked);
}
