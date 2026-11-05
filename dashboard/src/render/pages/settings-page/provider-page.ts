// The page that adds or edits a provider. Add asks for the tool first and
// then shows the fields of that tool alone; Edit shows the same form filled
// in, the name among the fields, with what was read of the provider as the
// page opened (version, login, usage) and the tool's panel under it. A save
// that works goes back to the Providers tab; a refused one stays here with
// the reason, every field as it was typed.

import { esc } from "../../ui/html.ts";
import { askButton, backLink, btnLink, confirmDialog, messageSlot, saveCancelActions } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { PROVIDER_TOOLS, providerFields, type Provider, type ProviderField, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import {
  PROVIDERS_ADD_ROUTE, PROVIDERS_EDIT_ROUTE, PROVIDERS_REMOVE_ROUTE, PROVIDERS_TAB_PATH, providerNewPath,
  providerStatusLines, type ProviderStatus,
} from "./providers.ts";
import { SETTINGS_ROUTE } from "./index.ts";
import { toolPanel, toolPart, usageBlock, type ToolCheck } from "./tools.ts";
import type { ModelsPanel } from "./models.ts";
import type { ToolUsage } from "./usage.ts";

/** The line a refusal is written into, named so the Remove dialog's form
 *  can write into the same one. */
export const PROVIDER_REFUSED_LINE = "provider-refused";

export interface ProviderPageOptions {
  /** The tool chosen. Absent on Add asks for it. */
  tool?: ProviderTool;
  /** The provider being edited, with its key. */
  edit?: { key: string; provider: Provider };
  /** What was read of the provider as the page opened. */
  status?: ProviderStatus;
  usage?: ToolUsage;
  /** The tool's last Check, and the models reading with what it is set against. */
  check?: ToolCheck;
  models?: ModelsPanel;
  /** Which tab under the Check is open, off `?aitab=`. */
  aiTab?: string;
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
  const hidden = edit ? { key: edit.key } : { tool };
  return (
    `<form id="provider-form" class="providerform reloadform" method="post" action="${edit ? PROVIDERS_EDIT_ROUTE : PROVIDERS_ADD_ROUTE}"` +
    ` data-done="${esc(PROVIDERS_TAB_PATH)}" data-cancel-href="${esc(PROVIDERS_TAB_PATH)}">` +
    Object.entries(hidden).map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`).join("") +
    `<p>${esc(t(lang, "settings.providers.tool"))}: <strong>${esc(TOOL_NAMES[tool] ?? tool)}</strong></p>` +
    field("provider-name", "name", t(lang, "settings.providers.name"), provider?.name ?? "", ` maxlength="64"`) +
    fields +
    (tool === "codex" ? `<p class="muted small">${esc(t(lang, "settings.providers.shadowHelp"))}</p>` : "") +
    messageSlot("refused", "failed", { id: PROVIDER_REFUSED_LINE }) +
    saveCancelActions("providerform", {}, lang) +
    `</form>`
  );
}

/** Remove: a danger button that asks first, with the board's one
 *  confirmation, and writes a refusal into the form's own line. */
function removeControl(key: string, name: string, lang: Language): string {
  const id = "provider-remove-ask";
  return (
    `<p>` +
    askButton({ label: t(lang, "project.remove"), dialogId: id, variant: "danger", ariaLabel: `${t(lang, "project.remove")} ${name}` }) +
    `</p>` +
    confirmDialog(lang, {
      id,
      title: t(lang, "settings.providers.removeTitle", { name }),
      sentence: t(lang, "settings.providers.removeSentence"),
      ok: { variant: "danger", pending: t(lang, "dialog.removing") },
      post: {
        action: PROVIDERS_REMOVE_ROUTE,
        hook: "reloadform",
        hidden: { key },
        data: { done: PROVIDERS_TAB_PATH, line: PROVIDER_REFUSED_LINE },
      },
    })
  );
}

/** What was read as the page opened: the tool and its version, the login
 *  (and the command that logs in, when it is out), when the login ends, then
 *  the usage. */
function openedBlock(opts: ProviderPageOptions, provider: Provider, now: number, lang: Language): string {
  const lines = opts.status
    ? `<ul class="checklist">${providerStatusLines(opts.status, provider, lang).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : "";
  return lines + usageBlock(opts.usage, now, lang);
}

export function renderProviderPage(nav: NavEntry[], generatedAt: string, opts: ProviderPageOptions): string {
  const lang = opts.lang ?? "en";
  const title = opts.edit
    ? t(lang, "settings.providers.editTitle", { name: opts.edit.provider.name })
    : t(lang, "settings.providers.newTitle");
  const tool = opts.edit?.provider.tool ?? opts.tool;
  const edit = opts.edit;
  const read = edit
    ? removeControl(edit.key, edit.provider.name, lang) +
      openedBlock(opts, edit.provider, Date.parse(generatedAt), lang) +
      toolPanel({ key: edit.key, tool: edit.provider.tool }, opts.check, opts.models ?? {}, lang, toolPart(opts.aiTab))
    : "";
  const body = backLink(PROVIDERS_TAB_PATH, title, "", { lang }) + (tool ? form(tool, edit, lang) + read : chooseTool(lang));
  // No reload of its own: this page is a form, and a reload wipes what is typed.
  return pageShell(title, nav, SETTINGS_ROUTE, body, generatedAt, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
