// The Providers tab under Settings → AI: every AI login the board may run a
// step on, each with its tool and folders, an Edit link, a field to rename
// it and a Remove. Under the list is Add, which opens a page of its own.

import { esc } from "../../ui/html.ts";
import { btnLink, buttonForm, facts, messageSlot } from "../../ui/components";
import { t, type Language } from "../../../i18n";
import { NORMAL_CLAUDE_DIR, NORMAL_CODEX_HOME, providerFields, type Provider, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import { rowForm } from "./models.ts";

export const PROVIDERS_ADD_ROUTE = "/api/queue/settings/providers/add";
export const PROVIDERS_EDIT_ROUTE = "/api/queue/settings/providers/edit";
export const PROVIDERS_RENAME_ROUTE = "/api/queue/settings/providers/rename";
export const PROVIDERS_REMOVE_ROUTE = "/api/queue/settings/providers/remove";

export const PROVIDER_NEW_PATH = "/settings/providers/new";
export const PROVIDER_EDIT_PATH = "/settings/providers/edit";
export const PROVIDERS_TAB_PATH = "/settings?tab=providers";

export const providerNewPath = (tool?: ProviderTool): string => (tool ? `${PROVIDER_NEW_PATH}?tool=${tool}` : PROVIDER_NEW_PATH);
export const providerEditPath = (key: string): string => `${PROVIDER_EDIT_PATH}?key=${encodeURIComponent(key)}`;

/** The folders a provider keeps its login in, one `<code>` each, the tool's
 *  own folder named when none is written. */
function folders(provider: Provider, lang: Language): string {
  const normal = { configDir: NORMAL_CLAUDE_DIR, codexHome: NORMAL_CODEX_HOME } as const;
  return providerFields(provider.tool)
    .filter((field) => provider[field] || field in normal)
    .map((field) => `<code>${esc(provider[field] || normal[field as keyof typeof normal])}</code>`)
    .join(" ") || `<span class="muted">${esc(t(lang, "settings.providers.normalFolder"))}</span>`;
}

/** One provider's row: its tool and folders, then Edit, a form to give it a
 *  new name and a Remove. The ids carry the row's place, since a key may
 *  hold characters an id should not. */
function providerValue(key: string, provider: Provider, i: number, lang: Language): string {
  const rename = buttonForm({
    id: `providers-rename-${i}`,
    action: PROVIDERS_RENAME_ROUTE,
    hook: "reloadform",
    hidden: { key },
    before:
      `<label for="providers-rename-${i}-name">${esc(t(lang, "settings.providers.newName"))}</label> ` +
      `<input id="providers-rename-${i}-name" name="newName" type="text" required maxlength="64" autocomplete="off">`,
    button: { id: `providers-rename-${i}-run`, label: t(lang, "settings.providers.rename"), pending: t(lang, "settings.providers.renaming") },
    after: messageSlot("refused"),
  });
  const remove = rowForm(
    PROVIDERS_REMOVE_ROUTE,
    `providers-remove-${i}`,
    { key },
    { label: t(lang, "project.remove"), pending: t(lang, "dialog.removing") },
    provider.name,
  );
  const edit = btnLink({ href: providerEditPath(key), label: t(lang, "settings.providers.edit"), small: true });
  return `${esc(TOOL_NAMES[provider.tool] ?? provider.tool)} · ${folders(provider, lang)} ${edit} ${rename}${remove}`;
}

/** The tab: every provider, and the link that adds one. */
export function providersBlock(providers: Record<string, Provider> | undefined, lang: Language = "en"): string {
  const listed = Object.entries(providers ?? {});
  const list = facts(listed.map(([key, p], i) => ({ label: esc(p.name), value: providerValue(key, p, i, lang) })));
  return (
    `<p>${esc(t(lang, "settings.providers.intro"))}</p>` +
    list +
    (listed.length ? "" : `<p class="muted">${esc(t(lang, "settings.providers.none"))}</p>`) +
    `<p>${btnLink({ href: PROVIDER_NEW_PATH, label: t(lang, "settings.providers.add"), variant: "primary" })}</p>`
  );
}
