// The page that adds a provider: the tool first, then the name and that
// tool's runtime fields. A save that works goes to the new provider on the
// Providers tab; a refused one stays here with the reason, every field as it
// was typed. A provider is edited on the Providers tab itself.

import { esc } from "../../ui/html.ts";
import { backLink, btnLink, messageSlot, saveCancelActions } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t, type Language } from "../../../i18n";
import { PROVIDER_TOOLS, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import { PROVIDERS_ADD_ROUTE, PROVIDERS_TAB_PATH, providerNewPath } from "./providers.ts";
import { fieldRow, PROVIDER_REFUSED_LINE, runtimeRows } from "./provider-detail.ts";
import { SETTINGS_ROUTE } from "./index.ts";

export interface ProviderPageOptions {
  /** The tool chosen. Absent asks for it. */
  tool?: ProviderTool;
  script?: string;
  lang?: Language;
  currentUrl?: string;
}

function chooseTool(lang: Language): string {
  return (
    `<p>${esc(t(lang, "settings.providers.chooseTool"))}</p><p>` +
    PROVIDER_TOOLS.map((tool) => btnLink({ href: providerNewPath(tool), label: TOOL_NAMES[tool] ?? tool })).join(" ") +
    `</p>`
  );
}

function form(tool: ProviderTool, lang: Language): string {
  return (
    `<form id="provider-form" class="providerform reloadform" method="post" action="${PROVIDERS_ADD_ROUTE}"` +
    ` data-done="${esc(PROVIDERS_TAB_PATH)}" data-cancel-href="${esc(PROVIDERS_TAB_PATH)}">` +
    `<input type="hidden" name="tool" value="${esc(tool)}">` +
    `<p>${esc(t(lang, "settings.providers.tool"))}: <strong>${esc(TOOL_NAMES[tool] ?? tool)}</strong></p>` +
    fieldRow({
      id: "provider-name", name: "name", label: t(lang, "settings.providers.displayName"),
      help: t(lang, "settings.providers.displayNameHelp"), value: "", extra: ` maxlength="64"`,
    }) +
    runtimeRows(tool, undefined, lang) +
    messageSlot("refused", "failed", { id: PROVIDER_REFUSED_LINE }) +
    saveCancelActions("providerform", {}, lang) +
    `</form>`
  );
}

export function renderProviderPage(nav: NavEntry[], generatedAt: string, opts: ProviderPageOptions): string {
  const lang = opts.lang ?? "en";
  const title = t(lang, "settings.providers.newTitle");
  const body = backLink(PROVIDERS_TAB_PATH, title, "", { lang }) + (opts.tool ? form(opts.tool, lang) : chooseTool(lang));
  // No reload of its own: this page is a form, and a reload wipes what is typed.
  return pageShell(title, nav, SETTINGS_ROUTE, body, generatedAt, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
