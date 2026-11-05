// The Providers tab under Settings → AI: every AI login the board may run a
// step on, one row each with its name, its tool and its login. A row opens
// the provider's page; under the table is Add, which opens a page of its own.

import { esc } from "../../ui/html.ts";
import { btnLink } from "../../ui/components";
import { capitalizeFirst } from "../../ui/job-state/provider-limit.ts";
import { renderSentence } from "../../../i18n/message.ts";
import { t, type Language } from "../../../i18n";
import { type Provider, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import { stamp, type ExtraCheck } from "./tools.ts";

export const PROVIDERS_ADD_ROUTE = "/api/queue/settings/providers/add";
export const PROVIDERS_EDIT_ROUTE = "/api/queue/settings/providers/edit";
export const PROVIDERS_REMOVE_ROUTE = "/api/queue/settings/providers/remove";

export const PROVIDER_NEW_PATH = "/settings/providers/new";
export const PROVIDER_EDIT_PATH = "/settings/providers/edit";
export const PROVIDERS_TAB_PATH = "/settings?tab=providers";

export const providerNewPath = (tool?: ProviderTool): string => (tool ? `${PROVIDER_NEW_PATH}?tool=${tool}` : PROVIDER_NEW_PATH);
export const providerEditPath = (key: string): string => `${PROVIDER_EDIT_PATH}?key=${encodeURIComponent(key)}`;

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

/** What a row of the providers table holds, in config order. */
export interface ProviderRow {
  key: string;
  name: string;
  /** The tool's own name, as the tab shows it. */
  tool: string;
  login: ProviderLoginState;
  /** The address of the provider's page. */
  href: string;
}

export function providerRows(
  providers: Record<string, Provider> | undefined,
  statuses: Record<string, ProviderStatus> = {},
): ProviderRow[] {
  return Object.entries(providers ?? {}).map(([key, p]) => ({
    key,
    name: p.name,
    tool: TOOL_NAMES[p.tool] ?? p.tool,
    login: providerLoginState(statuses[key]),
    href: providerEditPath(key),
  }));
}

/** The tab: every provider as a row of the Models per phase table's own kind
 *  of table — name, tool and login — each row opening the provider's page,
 *  and the link that adds one. */
export function providersBlock(
  providers: Record<string, Provider> | undefined,
  lang: Language = "en",
  statuses: Record<string, ProviderStatus> = {},
): string {
  const rows = providerRows(providers, statuses);
  const body = rows.map((r) =>
    `<tr data-row-href="${esc(r.href)}"><th scope="row"><a href="${esc(r.href)}">${esc(r.name)}</a></th>` +
    `<td>${esc(r.tool)}</td><td>${esc(t(lang, `settings.providers.state.${r.login}`))}</td></tr>`).join("");
  const table = rows.length
    ? `<table class="settingstable"><thead><tr><th>${esc(t(lang, "settings.providers.name"))}</th>` +
      `<th>${esc(t(lang, "settings.providers.tool"))}</th><th>${esc(t(lang, "settings.providers.login"))}</th></tr></thead>` +
      `<tbody>${body}</tbody></table>`
    : `<p class="muted">${esc(t(lang, "settings.providers.none"))}</p>`;
  return (
    `<p>${esc(t(lang, "settings.providers.intro"))}</p>` +
    table +
    `<p>${btnLink({ href: PROVIDER_NEW_PATH, label: t(lang, "settings.providers.add"), variant: "primary" })}</p>`
  );
}
