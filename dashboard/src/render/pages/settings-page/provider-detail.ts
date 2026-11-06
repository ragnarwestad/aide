// The chosen provider, on the right of the Providers tab: its tool's mark,
// its name and version with Remove, the status read as the tab opened, one
// form with the display name and the tool's runtime fields, then the usage
// and the tool's panel with its Check and models.

import { esc } from "../../ui/html.ts";
import { askButton, confirmDialog, messageSlot, saveCancelActions, TOOL_ICONS } from "../../ui/components";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { providerFields, type Provider, type ProviderField, type ProviderTool } from "../../../queue/providers/index.ts";
import { TOOL_NAMES } from "../specs-list";
import {
  PROVIDERS_EDIT_ROUTE, PROVIDERS_REMOVE_ROUTE, PROVIDERS_TAB_PATH, providerEditPath, providerStatusLines, versionNumber, type ProviderStatus,
} from "./providers.ts";
import { toolPanel, toolPart, usageBlock, type ToolCheck } from "./tools.ts";
import type { ModelsPanel } from "./models.ts";
import type { ToolUsage } from "./usage.ts";

/** The line a refusal is written into, named so the Remove dialog's form
 *  can write into the same one. */
export const PROVIDER_REFUSED_LINE = "provider-refused";

export interface ProviderDetailOptions {
  key: string;
  provider: Provider;
  status?: ProviderStatus;
  usage?: ToolUsage;
  /** The tool's last Check, and the models reading with what it is set against. */
  check?: ToolCheck;
  models?: ModelsPanel;
  /** Which tab under the Check is open, off `?aitab=`. */
  aiTab?: string;
}

/** Every field a provider of the tool has after its name, in the order the
 *  form asks for them. */
export type RuntimeField = "binary" | ProviderField | "autoCompact";
export function runtimeFields(tool: ProviderTool): RuntimeField[] {
  return ["binary", ...providerFields(tool), ...(tool === "claude" ? ["autoCompact" as const] : [])];
}

const PLACEHOLDERS: Record<RuntimeField, string> = {
  binary: "", configDir: "~/.claude", codexHome: "~/.codex", shadowHome: "~/.codex-shadow", autoCompact: "300000",
};
const HELP: Record<RuntimeField, TranslationKey> = {
  binary: "settings.providers.binaryHelp", configDir: "settings.providers.configDirHelp",
  codexHome: "settings.providers.codexHomeHelp", shadowHome: "settings.providers.shadowHelp",
  autoCompact: "settings.providers.autoCompactHelp",
};

/** One field: its label and what it does on the left, the input on the right. */
export function fieldRow(o: { id: string; name: string; label: string; help: string; value: string; extra?: string }): string {
  return (
    `<div class="fieldrow"><label for="${esc(o.id)}"><strong>${esc(o.label)}</strong>` +
    `<span class="muted small">${esc(o.help)}</span></label>` +
    `<input id="${esc(o.id)}" name="${esc(o.name)}" type="text" value="${esc(o.value)}" autocomplete="off"${o.extra ?? ""}></div>`
  );
}

/** The runtime fields of a tool, filled in from `provider` when there is one;
 *  each field's id is `<idPrefix>-<field>`. */
export function runtimeRows(tool: ProviderTool, provider: Provider | undefined, lang: Language, idPrefix = "provider"): string {
  const toolName = TOOL_NAMES[tool] ?? tool;
  return runtimeFields(tool).map((name) => fieldRow({
    id: `${idPrefix}-${name}`,
    name,
    label: t(lang, `settings.providers.${name}` as TranslationKey),
    help: t(lang, HELP[name], { tool: toolName }),
    value: provider?.[name] === undefined ? "" : String(provider[name]),
    extra: ` placeholder="${esc(name === "binary" ? tool : PLACEHOLDERS[name])}"${name === "autoCompact" ? ` inputmode="numeric"` : ""}`,
  })).join("");
}

function removeControl(key: string, name: string, lang: Language): string {
  const id = "provider-remove-ask";
  return (
    askButton({ label: t(lang, "project.remove"), dialogId: id, variant: "danger", ariaLabel: `${t(lang, "project.remove")} ${name}` }) +
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

export function providerDetail(o: ProviderDetailOptions, now: number, lang: Language): string {
  const { key, provider } = o;
  const version = versionNumber(o.status?.version);
  const head =
    `<div class="providerdetailhead"><span class="providericon" title="${esc(TOOL_NAMES[provider.tool] ?? provider.tool)}">${TOOL_ICONS[provider.tool]}</span>` +
    `<h3>${esc(provider.name)}</h3>` +
    (version ? `<span class="providerversion">${esc(version)}</span>` : "") +
    removeControl(key, provider.name, lang) +
    `</div>`;
  const status = o.status
    ? `<h4>${esc(t(lang, "settings.providers.status"))}</h4>` +
      `<ul class="checklist">${providerStatusLines(o.status, provider, lang).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : "";
  const here = providerEditPath(key);
  const form =
    `<form id="provider-form" class="providerform reloadform" method="post" action="${PROVIDERS_EDIT_ROUTE}"` +
    ` data-done="${esc(here)}" data-cancel-href="${esc(here)}">` +
    `<input type="hidden" name="key" value="${esc(key)}">` +
    fieldRow({
      id: "provider-name", name: "name", label: t(lang, "settings.providers.displayName"),
      help: t(lang, "settings.providers.displayNameHelp"), value: provider.name, extra: ` maxlength="64"`,
    }) +
    `<h4>${esc(t(lang, "settings.providers.runtime"))}</h4>` +
    runtimeRows(provider.tool, provider, lang) +
    messageSlot("refused", "failed", { id: PROVIDER_REFUSED_LINE }) +
    saveCancelActions("providerform", {}, lang) +
    `</form>`;
  return (
    head + status + form + usageBlock(o.usage, now, lang) +
    toolPanel({ key, tool: provider.tool }, o.check, o.models ?? {}, lang, toolPart(o.aiTab))
  );
}
