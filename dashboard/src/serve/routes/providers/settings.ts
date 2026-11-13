// Adding, editing (the name among the fields) and removing a provider from
// Settings → Providers. Add and Edit run the same rules in the same
// order. The file is written first and the live providers changed only once
// the write succeeded, the order the model choices follow
// (`settings-models.ts`); a refusal changes neither.

import { trimmedText as text } from "../../serve-helpers/http.ts";
import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  NORMAL_CLAUDE_DIR, NORMAL_CODEX_HOME, asProviderTool, autoCompactError, expandDir, providerFields, providerKeyFrom,
  providerNameError, providerUses, type Provider, type ProviderField,
} from "../../../queue/providers/index.ts";
import { PROVIDERS_ADD_ROUTE, PROVIDERS_EDIT_ROUTE, PROVIDERS_REMOVE_ROUTE, PROVIDERS_SWITCH_ROUTE } from "../../../render";
import { NAME_RE } from "../../../queue/parse-request.ts";
import { freeShortName, shortNameError, shortNameHolder, withShortNames } from "../../../queue/providers/short-name.ts";
import { TOOL_NAMES } from "../../../render/pages/specs-list/index.ts";
import { readProviderStatus } from "../../providers/status.ts";
import { readsUsage, readUsage, usageReader } from "../../providers/usage-kept.ts";
import { json, parseBody } from "../../serve-helpers";
import { prepareShadowHome } from "../../providers/shadow-home.ts";
import type { RoutesContext } from "../";
import { saveQueueSettings } from "../settings-save/index.ts";

const refuse = (error: string): Response => json({ error }, 400);

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

/** What an ID a person gives may hold. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The key a new provider is stored under, or the refusal: the ID asked
 *  for, else one made from the name that no other provider holds. */
function newKey(providers: Record<string, Provider>, name: string, asked: unknown): string | { error: string } {
  const id = text(asked);
  if (!id) return freeKey(providers, NAME_RE.test(name) ? name : providerKeyFrom(name));
  if (!ID_RE.test(id)) return { error: `${id} is not an ID a provider can have — use up to 64 letters, digits, "-" or "_"` };
  const held = Object.keys(providers).find((k) => k.toLowerCase() === id.toLowerCase());
  return held ? { error: `${held} is already a provider's ID — pick another ID` } : id;
}

/** The binary path and the auto-compact threshold read off the body and
 *  checked. A binary path is written from `/` or `~/` and is a program on
 *  the serving host; auto-compact is Claude Code's alone. */
function readRuntime(tool: Provider["tool"], asked: Record<string, unknown>, home: string): Partial<Provider> | string {
  const out: Partial<Provider> = {};
  const binary = text(asked.binary);
  if (binary) {
    if (!binary.startsWith("/") && !binary.startsWith("~/")) return `The binary path must be written from / or ~/ — ${binary} was given`;
    const expanded = expandDir(binary, home);
    if (!existsSync(expanded)) return `${binary} is not there on the serving host — give the path of the program`;
    if (!statSync(expanded).isFile()) return `${binary} is a folder on the serving host — give the path of the program`;
    try {
      accessSync(expanded, constants.X_OK);
    } catch {
      return `${binary} is not a program the serving host can run — make it executable`;
    }
    out.binary = binary;
  }
  const tokens = text(asked.autoCompact);
  if (tool === "claude" && tokens) {
    const n = Number(tokens);
    const bad = autoCompactError(n);
    if (bad) return bad.replace(String(n), tokens);
    out.autoCompact = n;
  }
  return out;
}

/** The folder a provider's login lives in, expanded: what two providers of
 *  one tool must not share. */
function loginOf(provider: Provider, home: string): string {
  if (provider.tool === "claude") return expandDir(provider.configDir || NORMAL_CLAUDE_DIR, home);
  if (provider.tool === "codex") return expandDir(provider.shadowHome || provider.codexHome || NORMAL_CODEX_HOME, home);
  return "opencode";
}

/** The fields a tool has, read off the body and checked: written from `/`
 *  or `~/`, and not a path that is a file. A folder that is not there yet is
 *  no refusal: it is made once the rest has passed. */
function readFields(tool: Provider["tool"], asked: Record<string, unknown>, home: string): Partial<Provider> | string {
  const out: Partial<Provider> = {};
  for (const field of providerFields(tool) as ProviderField[]) {
    const raw = text(asked[field]);
    if (!raw) continue;
    const dir = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
    if (!dir.startsWith("/") && !dir.startsWith("~/")) return `The folder must be written from / or ~/ — ${dir} was given`;
    const expanded = expandDir(dir, home);
    if (existsSync(expanded) && !statSync(expanded).isDirectory()) {
      return `${dir} is a file on the serving host, not a folder — give a folder`;
    }
    out[field] = dir;
  }
  return out;
}

/** Why this provider cannot be saved next to the others, or null: a login
 *  another provider of the tool already uses. */
function conflict(providers: Record<string, Provider>, key: string | undefined, provider: Provider, home: string): string | null {
  const login = loginOf(provider, home);
  const taken = Object.entries(providers).find(([k, p]) => k !== key && p.tool === provider.tool && loginOf(p, home) === login);
  if (!taken) return null;
  return provider.tool === "opencode"
    ? `OpenCode has one login on the serving host and ${taken[1].name} already uses it — there is only one OpenCode provider`
    : `${taken[1].name} already logs in under ${login} — give this provider a folder of its own`;
}

/** Whether the provider's tool starts on the serving host. Only `--version`
 *  is asked: a login is never read to decide a save. */
async function notInstalled(ctx: RoutesContext, key: string, provider: Provider): Promise<string | null> {
  const read = ctx.opts.providerProbe ?? readProviderStatus;
  const status = await read(key, provider, { login: false });
  if (status.installed) return null;
  const tool = TOOL_NAMES[provider.tool] ?? provider.tool;
  return `${tool} is not installed on the machine serving the board — install it there, then save again`;
}

/** The folders the provider logs in under, made when they are missing, and a
 *  shadow home prepared. Null when it is done, else the sentence saying why
 *  not. */
function prepareFolders(provider: Provider, home: string): string | null {
  try {
    for (const dir of [provider.configDir, provider.codexHome]) if (dir) mkdirSync(expandDir(dir, home), { recursive: true });
  } catch (e) {
    return `The folder could not be made on the serving host: ${(e as Error).message}`;
  }
  if (provider.tool === "codex" && provider.shadowHome) {
    return prepareShadowHome(expandDir(provider.codexHome || NORMAL_CODEX_HOME, home), expandDir(provider.shadowHome, home));
  }
  return null;
}

/** The short name a save gives the provider, or the refusal. Add makes one
 *  from the name that no other provider has; Edit takes the one the form
 *  posts, as typed, and keeps the stored one when the form posts none. */
function readShort(providers: Record<string, Provider>, key: string | undefined, name: string, asked: unknown): { short?: string } | string {
  const others = withShortNames(providers);
  if (!key) return { short: freeShortName(name, Object.values(others).flatMap((p) => (p.short ? [p.short] : []))) };
  if (asked === undefined) return providers[key]?.short ? { short: providers[key].short } : {};
  const short = text(asked);
  const bad = shortNameError(short);
  if (bad) return bad;
  const holder = shortNameHolder(others, short, key);
  return holder ? `${holder} already has the short name ${short} — pick another` : { short };
}

/** Add and Edit, which run the same rules in this order: the name, the
 *  short name, the fields, the login not another's, the tool installed, then
 *  the folders are made and the provider written. */
async function saveChecked(
  ctx: RoutesContext, key: string | undefined, tool: Provider["tool"], asked: Record<string, unknown>,
): Promise<Response> {
  const providers = ctx.queue.defaults.providers ?? {};
  const name = text(asked.name);
  const bad = providerNameError(name);
  if (bad) return refuse(bad);
  const taken = nameTaken(providers, name, key);
  if (taken) return refuse(`${taken} is already a provider — pick another name${key ? "" : ", or rename that one"}`);
  const short = readShort(providers, key, name, asked.short);
  if (typeof short === "string") return refuse(short);
  const home = homedir();
  const fields = readFields(tool, asked, home);
  if (typeof fields === "string") return refuse(fields);
  const runtime = readRuntime(tool, asked, home);
  if (typeof runtime === "string") return refuse(runtime);
  const off = key && providers[key]?.enabled === false ? { enabled: false as const } : {};
  const provider: Provider = { name, ...short, tool, ...off, ...fields, ...runtime };
  const clash = conflict(providers, key, provider, home);
  if (clash) return refuse(clash);
  const made = key ?? newKey(providers, name, asked.providerId);
  if (typeof made !== "string") return refuse(made.error);
  const target = made;
  const missing = await notInstalled(ctx, target, provider);
  if (missing) return refuse(missing);
  const prepared = prepareFolders(provider, home);
  if (prepared) return refuse(prepared);
  return save(ctx, target, provider, { name });
}

/** Writes the provider, and reads its usage again at once rather than on the server's next round. */
function save(ctx: RoutesContext, key: string, provider: Provider, extra: Record<string, unknown> = {}): Response {
  const error = saveQueueSettings(ctx, { providers: { [key]: provider } });
  if (error) return refuse(error);
  const read = usageReader(ctx.opts);
  if (read && readsUsage(provider.tool)) void readUsage(ctx.opts, key, provider, read);
  return json({ ok: true, key, ...extra });
}

function addProvider(ctx: RoutesContext, asked: Record<string, unknown>): Promise<Response> | Response {
  const tool = asProviderTool(asked.tool);
  if (!tool) return refuse("Choose the tool the provider is for: Claude Code, Codex or OpenCode");
  return saveChecked(ctx, undefined, tool, asked);
}

function editProvider(ctx: RoutesContext, asked: Record<string, unknown>): Promise<Response> | Response {
  const key = text(asked.key);
  const current = ctx.queue.defaults.providers?.[key];
  if (!current) return refuse(`${key || "That"} is not a provider — nothing to edit`);
  return saveChecked(ctx, key, current.tool, asked);
}

/** The on/off switch: off is written as `enabled: false`, on removes it. */
function switchProvider(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  const key = text(asked.key);
  const current = ctx.queue.defaults.providers?.[key];
  if (!current) return refuse(`${key || "That"} is not a provider — nothing to switch`);
  const on = asked.enabled === true || asked.enabled === "true";
  const { enabled: _was, ...rest } = current;
  return save(ctx, key, on ? rest : { ...rest, enabled: false });
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
  const error = saveQueueSettings(ctx, { providers: { [key]: null } });
  if (error) return refuse(error);
  return json({ ok: true, key });
}

export async function handleProviderSettingsRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  if (
    path !== PROVIDERS_ADD_ROUTE && path !== PROVIDERS_EDIT_ROUTE && path !== PROVIDERS_REMOVE_ROUTE &&
    path !== PROVIDERS_SWITCH_ROUTE
  ) {
    return null;
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const asked = await parseBody(req);
  if (asked instanceof Response) return asked;
  if (path === PROVIDERS_ADD_ROUTE) return addProvider(ctx, asked);
  if (path === PROVIDERS_EDIT_ROUTE) return editProvider(ctx, asked);
  if (path === PROVIDERS_SWITCH_ROUTE) return switchProvider(ctx, asked);
  return removeProvider(ctx, asked);
}
