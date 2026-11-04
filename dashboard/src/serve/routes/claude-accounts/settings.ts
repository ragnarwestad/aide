// Adding, renaming and removing a Claude account from Settings → AI →
// Claude Code → Accounts. The file is written first and the live accounts
// changed only once the write succeeded, the order the model choices
// follow (`settings-models.ts`); a refusal changes neither.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { persistQueueSettings } from "../../../queue/queue.ts";
import { NAME_RE } from "../../../queue/parse-request.ts";
import { DEFAULT_ACCOUNT, DEFAULT_CONFIG_DIR, expandConfigDir } from "../../../queue/runner/claude-accounts.ts";
import { ACCOUNTS_ADD_ROUTE, ACCOUNTS_REMOVE_ROUTE, ACCOUNTS_RENAME_ROUTE } from "../../../render";
import { bodyToObject, json, readBounded } from "../../serve-helpers";
import type { RoutesContext } from "../";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const refuse = (error: string): Response => json({ error }, 400);
const isDefault = (name: string): boolean => name.toLowerCase() === DEFAULT_ACCOUNT.toLowerCase();

const BAD_NAME = (name: string): string =>
  `${name || "An empty name"} is not a name an account can have — use up to 64 letters, digits, "." , "_" or "-"`;
const IS_DEFAULT =
  `${DEFAULT_ACCOUNT} is the login the board uses today and is always there — pick another name for the account`;

async function parseBody(req: Request): Promise<Record<string, unknown> | Response> {
  const body = await readBounded(req);
  if ("refusal" in body) return body.refusal;
  try {
    return (bodyToObject(body.text, req.headers.get("content-type")) ?? {}) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed body" }, 400);
  }
}

/** The account's name as the live table spells it, found in any case. */
const listed = (accounts: Record<string, unknown>, name: string): string | undefined =>
  Object.keys(accounts).find((key) => key.toLowerCase() === name.toLowerCase());

function addAccount(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const accounts = ctx.queue.defaults.claudeAccounts ?? {};
  const name = text(asked.name);
  if (!NAME_RE.test(name)) return refuse(BAD_NAME(name));
  if (isDefault(name)) return refuse(IS_DEFAULT);
  if (listed(accounts, name)) return refuse(`${name} is already an account — pick another name, or rename that one`);
  const raw = text(asked.configDir);
  const configDir = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  if (!configDir.startsWith("/") && !configDir.startsWith("~/")) {
    return refuse(`The directory must be written from / or ~/ — ${configDir || "none"} was given`);
  }
  const home = homedir();
  const expanded = expandConfigDir(configDir, home);
  if (expanded === expandConfigDir(DEFAULT_CONFIG_DIR, home)) {
    return refuse(`${DEFAULT_CONFIG_DIR} is the ${DEFAULT_ACCOUNT} account's own directory — give the new account a directory of its own`);
  }
  const taken = Object.entries(accounts).find(([, a]) => expandConfigDir(a.configDir, home) === expanded);
  if (taken) return refuse(`${configDir} is already the directory of ${taken[0]} — give this account a directory of its own`);
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    return refuse(`${configDir} does not exist on the serving host — make the directory and log in there first (running-specs.md says how)`);
  }
  const error = persistQueueSettings(ctx.opts.queueConfigFile, { claudeAccounts: { [name]: { configDir } } });
  if (error) return refuse(error);
  ctx.queue.defaults.claudeAccounts = { ...accounts, [name]: { configDir } };
  return json({ ok: true, name });
}

function renameAccount(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const accounts = ctx.queue.defaults.claudeAccounts ?? {};
  const asName = text(asked.name);
  const newName = text(asked.newName);
  if (isDefault(asName) || isDefault(newName)) return refuse(IS_DEFAULT.replace("pick another name for the account", "it cannot be renamed, and no other account can take its name"));
  const name = listed(accounts, asName);
  if (!name) return refuse(`${asName || "That"} is not an account — nothing to rename`);
  if (!NAME_RE.test(newName)) return refuse(BAD_NAME(newName));
  if (Object.keys(accounts).some((key) => key.toLowerCase() === newName.toLowerCase())) {
    return refuse(`${newName} is already an account — pick another name`);
  }
  const entry = accounts[name]!;
  // One write: the old key goes and the new one comes.
  const error = persistQueueSettings(ctx.opts.queueConfigFile, { claudeAccounts: { [name]: null, [newName]: entry } });
  if (error) return refuse(error);
  const { [name]: _gone, ...rest } = accounts;
  ctx.queue.defaults.claudeAccounts = { ...rest, [newName]: entry };
  return json({ ok: true, name: newName });
}

function removeAccount(ctx: RoutesContext, asked: Record<string, unknown>): Response {
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  const accounts = ctx.queue.defaults.claudeAccounts ?? {};
  const asName = text(asked.name);
  if (isDefault(asName)) return refuse(`${DEFAULT_ACCOUNT} is the login the board uses today and cannot be removed`);
  const name = listed(accounts, asName);
  if (!name) return refuse(`${asName || "That"} is not an account — nothing to remove`);
  const error = persistQueueSettings(ctx.opts.queueConfigFile, { claudeAccounts: { [name]: null } });
  if (error) return refuse(error);
  const { [name]: _gone, ...rest } = accounts;
  // Left empty, the table is absent, as the config reader leaves it.
  ctx.queue.defaults.claudeAccounts = Object.keys(rest).length ? rest : undefined;
  return json({ ok: true, name });
}

export async function handleAccountSettingsRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path !== ACCOUNTS_ADD_ROUTE && path !== ACCOUNTS_RENAME_ROUTE && path !== ACCOUNTS_REMOVE_ROUTE) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const asked = await parseBody(req);
  if (asked instanceof Response) return asked;
  if (path === ACCOUNTS_ADD_ROUTE) return addAccount(ctx, asked);
  return path === ACCOUNTS_RENAME_ROUTE ? renameAccount(ctx, asked) : removeAccount(ctx, asked);
}
