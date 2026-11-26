// The Providers page: the list of providers on the left — each with its
// tool's mark, its name, its version, its login and its on/off switch — and
// the chosen provider on the right (`provider-detail.ts`). Beside the page's
// title, Add, and when the logins were read with the link that reads them
// again. Add, there and at the end of the list, opens the Add dialog
// (`provider-add.ts`). The page is opened from the "…" menu, as Settings is.

import { esc, relTimeLabel } from "../../ui/html.ts";
import { backLink, messageSlot, switchControl, toolIcon } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t, type Language } from "../../../i18n";
import type { Provider } from "../../../queue/providers/index.ts";
import {
  PROVIDERS_SWITCH_ROUTE, PROVIDERS_ROUTE, providerEditPath, providerRows, type ProviderRow, type ProviderStatus,
} from "./providers.ts";
import { providerDetail, type ProviderDetailOptions } from "./provider-detail.ts";
import { PROVIDER_ADD_DIALOG, providerAddDialog } from "./provider-add.ts";

/** The line a refused switch is written into. */
export const PROVIDER_SWITCH_REFUSED = "provider-switch-refused";

function rowLine(r: ProviderRow, lang: Language): string {
  const state = t(lang, `settings.providers.state.${r.login}`);
  return r.plan ? `${state} · ${r.plan}` : state;
}

/** The switch, as a form of its own: the press sends the other state, and
 *  the page loads again with it. */
function switchForm(r: ProviderRow, chosen: string | undefined, lang: Language): string {
  const back = chosen ? providerEditPath(chosen) : PROVIDERS_ROUTE;
  return (
    `<form class="reloadform" method="post" action="${PROVIDERS_SWITCH_ROUTE}" data-done="${esc(back)}" data-line="${PROVIDER_SWITCH_REFUSED}">` +
    `<input type="hidden" name="key" value="${esc(r.key)}"><input type="hidden" name="enabled" value="${r.on ? "false" : "true"}">` +
    switchControl({
      label: t(lang, "settings.providers.switchLabel", { name: r.name }), checked: r.on, submit: true,
      onWord: t(lang, "settings.providers.on"), offWord: t(lang, "settings.providers.off"),
    }) +
    `</form>`
  );
}

function row(r: ProviderRow, chosen: string | undefined, lang: Language): string {
  return (
    `<li class="providerrow${r.key === chosen ? " chosen" : ""}">` +
    `<a class="provideritem" href="${esc(r.href)}"${r.key === chosen ? ` aria-current="page"` : ""}>` +
    toolIcon(r.tool, r.toolName) +
    `<span class="providertext"><span class="providername"><strong>${esc(r.name)}</strong>` +
    (r.short ? ` <span class="providerversion">${esc(r.short)}</span>` : "") +
    (r.version ? ` <span class="providerversion">${esc(r.version)}</span>` : "") +
    `</span><span class="muted small">${esc(rowLine(r, lang))}</span></span></a>` +
    switchForm(r, chosen, lang) +
    `</li>`
  );
}

export interface ProvidersPageOptions {
  providers?: Record<string, Provider>;
  statuses?: Record<string, ProviderStatus>;
  /** The provider shown on the right, with what was read of it. */
  detail?: ProviderDetailOptions;
  /** Where "← Back" goes, from the request's own `Referer`; `/` without one. */
  backHref?: string;
  script?: string;
  lang?: Language;
  /** The request's own address, so the language links keep the reader here. */
  currentUrl?: string;
}

/** Add, and when the logins were read with the link that reads them again:
 *  at the far end of the title's line. */
function titleEnd(statuses: Record<string, ProviderStatus> | undefined, chosen: string | undefined, now: number, lang: Language): string {
  const read = Object.values(statuses ?? {}).map((s) => s.at).sort()[0];
  return (
    `<button type="button" class="iconlink" data-ask="${PROVIDER_ADD_DIALOG}" aria-label="${esc(t(lang, "settings.providers.addProvider"))}" title="${esc(t(lang, "settings.providers.addProvider"))}">+</button>` +
    (read
      ? `<span class="providerschecked muted small">${esc(t(lang, "settings.providers.checked", { when: relTimeLabel(read, now, lang) }))} · ` +
        `<a href="${esc(chosen ? providerEditPath(chosen) : PROVIDERS_ROUTE)}">${esc(t(lang, "settings.providers.recheck"))}</a></span>`
      : "")
  );
}

export function renderProvidersPage(entries: NavEntry[], generatedAt: string, o: ProvidersPageOptions): string {
  const lang = o.lang ?? "en";
  const now = Date.parse(generatedAt);
  const rows = providerRows(o.providers, o.statuses);
  const chosen = o.detail?.key;
  const list =
    `<ul class="providerlist">${rows.map((r) => row(r, chosen, lang)).join("")}` +
    `<li class="providerrow"><button type="button" class="provideritem" data-ask="${PROVIDER_ADD_DIALOG}"><span class="providericon" aria-hidden="true">+</span>` +
    `<span class="providertext">${esc(t(lang, "settings.providers.addProvider"))}</span></button></li></ul>`;
  const detail = o.detail ? providerDetail(o.detail, now, lang) : `<p class="muted">${esc(t(lang, "settings.providers.none"))}</p>`;
  const title = t(lang, "settings.providers.heading");
  const body =
    backLink(o.backHref ?? "/", title, titleEnd(o.statuses, chosen, now, lang), { lang }) +
    messageSlot("refused", "failed", { id: PROVIDER_SWITCH_REFUSED }) +
    `<div class="providerpanes">${list}<section class="providerdetail">${detail}</section></div>` +
    providerAddDialog(lang);
  return pageShell(title, entries, PROVIDERS_ROUTE, body, generatedAt, {
    script: o.script, hideHeading: true, hideTabBar: true, lang: o.lang, currentUrl: o.currentUrl,
  });
}
