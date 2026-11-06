// What the Providers tab under Settings is made of: its addresses, what was
// read of each provider, and the row each provider is drawn from. The list
// is drawn by `provider-list.ts` and the chosen provider by
// `provider-detail.ts`.

import { capitalizeFirst } from "../../ui/job-state/provider-limit.ts";
import { renderSentence } from "../../../i18n/message.ts";
import { t, type Language } from "../../../i18n";
import { type Provider, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import { stamp, type ExtraCheck } from "./tools.ts";

export const PROVIDERS_ADD_ROUTE = "/api/queue/settings/providers/add";
export const PROVIDERS_EDIT_ROUTE = "/api/queue/settings/providers/edit";
export const PROVIDERS_REMOVE_ROUTE = "/api/queue/settings/providers/remove";
export const PROVIDERS_SWITCH_ROUTE = "/api/queue/settings/providers/switch";

export const PROVIDER_NEW_PATH = "/settings/providers/new";
export const PROVIDER_EDIT_PATH = "/settings/providers/edit";
export const PROVIDERS_TAB_PATH = "/settings?tab=providers";

/** A provider's own place: the Providers tab with it chosen. */
export const providerEditPath = (key: string): string => `${PROVIDERS_TAB_PATH}&provider=${encodeURIComponent(key)}`;

/** The provider the tab shows: the one `asked` names, else the first in
 *  config order, else none. */
export function selectedProviderKey(providers: Record<string, Provider> | undefined, asked: string | null | undefined): string | undefined {
  const keys = Object.keys(providers ?? {});
  return asked && keys.includes(asked) ? asked : keys[0];
}

/** The version number in what `<tool> --version` printed: "2.1.318" out of
 *  "2.1.318 (Claude Code)" or "codex-cli 0.166.0". */
export function versionNumber(printed: string | undefined): string | undefined {
  return printed?.match(/\d+\.\d+[\w.+-]*/)?.[0];
}

/** What the board read of one provider when the tab opened. Declared here
 *  because `src/render` may not import `src/serve`, where it is read. */
export interface ProviderStatus {
  key: string;
  /** When it was read, as an ISO time. */
  at: string;
  /** False when the tool could not be started; nothing else was asked. */
  installed: boolean;
  /** The first line `<tool> --version` printed, as printed. */
  version?: string;
  /** The login, as the check's own answer: the sentence, whether it is a
   *  yes, a no or could not be read, and when it ends. */
  login?: ExtraCheck;
}

/** What a provider's page says of what was read: the tool, then the login,
 *  then when the login ends. A login that could not be read says so and
 *  says to open the tab again; it is never said to be "not logged in". */
export function providerStatusLines(status: ProviderStatus, provider: Provider, lang: Language): string[] {
  if (!status.installed) {
    return [t(lang, "settings.providers.notInstalled", { tool: TOOL_NAMES[provider.tool] ?? provider.tool })];
  }
  const lines = [
    status.version
      ? t(lang, "settings.providers.installed", { version: status.version })
      : t(lang, "settings.providers.installedNoVersion"),
  ];
  const login = status.login;
  if (!login) return lines;
  if (login.ok === null || !login.answer) {
    lines.push(t(lang, "settings.providers.loginUnread"));
  } else {
    lines.push(capitalizeFirst(renderSentence(lang, login.detail ? [login.answer, login.detail] : login.answer) ?? ""));
  }
  if (login.ends) lines.push(t(lang, "settings.providers.loginEnds", { at: stamp(login.ends) }));
  return lines;
}

/** The login of a row, in one word: `in`, `out`, `unread` (the login could not
 *  be read, or was not asked) or `notInstalled`. A mixed Claude login
 *  (`login.inWithAs` with `ok: false`) is still a login. */
export type ProviderLoginState = "in" | "out" | "unread" | "notInstalled";

export function providerLoginState(status: ProviderStatus | undefined): ProviderLoginState {
  if (!status) return "unread";
  if (!status.installed) return "notInstalled";
  const login = status.login;
  if (!login || login.ok === null || !login.answer) return "unread";
  if (login.answer.key === "login.out") return "out";
  return login.answer.key.startsWith("login.in") ? "in" : "unread";
}

/** What a row of the providers list holds, in config order. */
export interface ProviderRow {
  key: string;
  name: string;
  tool: ProviderTool;
  /** The tool's own name, as the tab shows it. */
  toolName: string;
  version?: string;
  login: ProviderLoginState;
  /** The plan the login is on, or how it logged in, where the tool says. */
  plan?: string;
  /** Not switched off. */
  on: boolean;
  /** The address that chooses the provider. */
  href: string;
}

/** The plan a login is on: Claude Code's subscription, else the way the
 *  tool says it logged in (Codex: "ChatGPT"). */
function planOf(login: ExtraCheck | undefined): string | undefined {
  if (!login?.answer || login.answer.key === "login.out") return undefined;
  const method = login.answer.values?.method;
  return login.plan ?? (typeof method === "string" && method ? method : undefined);
}

export function providerRows(
  providers: Record<string, Provider> | undefined,
  statuses: Record<string, ProviderStatus> = {},
): ProviderRow[] {
  return Object.entries(providers ?? {}).map(([key, p]) => {
    const version = versionNumber(statuses[key]?.version);
    const plan = planOf(statuses[key]?.login);
    return {
      key,
      name: p.name,
      tool: p.tool,
      toolName: TOOL_NAMES[p.tool] ?? p.tool,
      ...(version ? { version } : {}),
      login: providerLoginState(statuses[key]),
      ...(plan ? { plan } : {}),
      on: p.enabled !== false,
      href: providerEditPath(key),
    };
  });
}
