// The Providers tab: the list of providers on the left — each with its
// tool's mark, its name, its version, its login and its on/off switch — and
// the chosen provider on the right (`provider-detail.ts`). Over the two, the
// heading with Add, and when the logins were read with the link that reads
// them again. Add, there and at the end of the list, opens the Add dialog
// (`provider-add.ts`).

import { esc, relTimeLabel } from "../../ui/html.ts";
import { messageSlot, switchControl, TOOL_ICONS } from "../../ui/components";
import { t, type Language } from "../../../i18n";
import type { Provider } from "../../../queue/providers/index.ts";
import {
  PROVIDERS_SWITCH_ROUTE, PROVIDERS_TAB_PATH, providerEditPath, providerRows, type ProviderRow, type ProviderStatus,
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
  const back = chosen ? providerEditPath(chosen) : PROVIDERS_TAB_PATH;
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
    `<span class="providericon" title="${esc(r.toolName)}">${TOOL_ICONS[r.tool]}</span>` +
    `<span class="providertext"><span class="providername"><strong>${esc(r.name)}</strong>` +
    (r.version ? ` <span class="providerversion">${esc(r.version)}</span>` : "") +
    `</span><span class="muted small">${esc(rowLine(r, lang))}</span></span></a>` +
    switchForm(r, chosen, lang) +
    `</li>`
  );
}

export interface ProvidersTabOptions {
  providers?: Record<string, Provider>;
  statuses?: Record<string, ProviderStatus>;
  /** The provider shown on the right, with what was read of it. */
  detail?: ProviderDetailOptions;
  now: number;
}

export function providersTab(o: ProvidersTabOptions, lang: Language): string {
  const rows = providerRows(o.providers, o.statuses);
  const chosen = o.detail?.key;
  const read = Object.values(o.statuses ?? {}).map((s) => s.at).sort()[0];
  const head =
    `<div class="providershead"><h2>${esc(t(lang, "settings.providers.heading"))}</h2>` +
    `<button type="button" class="iconlink" data-ask="${PROVIDER_ADD_DIALOG}" aria-label="${esc(t(lang, "settings.providers.addProvider"))}" title="${esc(t(lang, "settings.providers.addProvider"))}">+</button>` +
    (read
      ? `<span class="providerschecked muted small">${esc(t(lang, "settings.providers.checked", { when: relTimeLabel(read, o.now, lang) }))} · ` +
        `<a href="${esc(chosen ? providerEditPath(chosen) : PROVIDERS_TAB_PATH)}">${esc(t(lang, "settings.providers.recheck"))}</a></span>`
      : "") +
    `</div>`;
  const list =
    `<ul class="providerlist">${rows.map((r) => row(r, chosen, lang)).join("")}` +
    `<li class="providerrow"><button type="button" class="provideritem" data-ask="${PROVIDER_ADD_DIALOG}"><span class="providericon" aria-hidden="true">+</span>` +
    `<span class="providertext">${esc(t(lang, "settings.providers.addProvider"))}</span></button></li></ul>`;
  const detail = o.detail ? providerDetail(o.detail, o.now, lang) : `<p class="muted">${esc(t(lang, "settings.providers.none"))}</p>`;
  return (
    head +
    messageSlot("refused", "failed", { id: PROVIDER_SWITCH_REFUSED }) +
    `<div class="providerpanes">${list}<section class="providerdetail">${detail}</section></div>` +
    providerAddDialog(lang)
  );
}
