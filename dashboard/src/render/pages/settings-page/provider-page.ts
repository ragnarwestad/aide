// The page that adds or edits a provider. Add asks for the tool first and
// then shows the fields of that tool alone; Edit shows the same form filled
// in, with the tool named and not asked again. A save that works goes back
// to the Providers tab; a refused one stays here with the reason.

import { esc } from "../../ui/html.ts";
import { backLink, btnLink, buttonForm, messageSlot } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { PROVIDER_TOOLS, providerFields, type Provider, type ProviderField, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import {
  PROVIDERS_ADD_ROUTE, PROVIDERS_EDIT_ROUTE, PROVIDERS_TAB_PATH, providerNewPath,
} from "./providers.ts";
import { SETTINGS_ROUTE } from "./index.ts";

export interface ProviderPageOptions {
  /** The tool chosen. Absent on Add asks for it. */
  tool?: ProviderTool;
  /** The provider being edited, with its key. */
  edit?: { key: string; provider: Provider };
  script?: string;
  lang?: Language;
  currentUrl?: string;
}

const PLACEHOLDERS: Record<ProviderField, string> = { configDir: "~/.claude-2", codexHome: "~/.codex-2", shadowHome: "~/.codex-shadow" };

const field = (id: string, name: string, label: string, value: string, extra = ""): string =>
  `<p><label for="${esc(id)}">${esc(label)}</label> <input id="${esc(id)}" name="${esc(name)}" type="text" value="${esc(value)}" autocomplete="off"${extra}></p>`;

function chooseTool(lang: Language): string {
  return (
    `<p>${esc(t(lang, "settings.providers.chooseTool"))}</p><p>` +
    PROVIDER_TOOLS.map((tool) => btnLink({ href: providerNewPath(tool), label: TOOL_NAMES[tool] ?? tool })).join(" ") +
    `</p>`
  );
}

function form(tool: ProviderTool, edit: ProviderPageOptions["edit"], lang: Language): string {
  const provider = edit?.provider;
  const fields = providerFields(tool)
    .map((name) =>
      field(`provider-${name}`, name, t(lang, `settings.providers.${name}` as TranslationKey), provider?.[name] ?? "", ` placeholder="${PLACEHOLDERS[name]}"`))
    .join("");
  return buttonForm({
    id: "provider-form",
    action: edit ? PROVIDERS_EDIT_ROUTE : PROVIDERS_ADD_ROUTE,
    hook: "reloadform",
    data: { done: PROVIDERS_TAB_PATH },
    hidden: edit ? { key: edit.key } : { tool },
    before:
      `<p>${esc(t(lang, "settings.providers.tool"))}: <strong>${esc(TOOL_NAMES[tool] ?? tool)}</strong></p>` +
      (edit ? "" : field("provider-name", "name", t(lang, "settings.providers.name"), "", ` required maxlength="64"`)) +
      fields +
      (tool === "codex" ? `<p class="muted small">${esc(t(lang, "settings.providers.shadowHelp"))}</p>` : ""),
    button: { id: "provider-save", label: t(lang, "list.checksSave"), variant: "primary", pending: t(lang, "list.checksSaving") },
    after: messageSlot("refused", "failed") + btnLink({ href: PROVIDERS_TAB_PATH, label: t(lang, "dialog.cancel") }),
  });
}

export function renderProviderPage(nav: NavEntry[], generatedAt: string, opts: ProviderPageOptions): string {
  const lang = opts.lang ?? "en";
  const title = opts.edit
    ? t(lang, "settings.providers.editTitle", { name: opts.edit.provider.name })
    : t(lang, "settings.providers.newTitle");
  const tool = opts.edit?.provider.tool ?? opts.tool;
  const body = backLink(PROVIDERS_TAB_PATH, title, "", { lang }) + (tool ? form(tool, opts.edit, lang) : chooseTool(lang));
  // No reload of its own: this page is a form, and a reload wipes what is typed.
  return pageShell(title, nav, SETTINGS_ROUTE, body, generatedAt, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
