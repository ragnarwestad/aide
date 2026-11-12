import { t, type Language } from "../../../i18n";
import { TOOL_NAMES } from "../../../queue/providers/tools.ts";
import { headerMenu, shareBar } from "../components";
import { ICON_USAGE } from "../components/icons.ts";
import { esc } from "../html.ts";
import type { UsageDialogEntry } from "./view.ts";
import { usageDialogView } from "./view.ts";

export const USAGE_DIALOG_ROUTE = "/api/queue/settings/providers/usage";

export const usageButton = (lang: Language): string => headerMenu({
  label: t(lang, "shell.usage"), icon: ICON_USAGE, id: "usage-dialog",
  data: { src: USAGE_DIALOG_ROUTE }, panelClass: "usagepanel",
  content: `<div data-usage-content><h2>${esc(t(lang, "shell.usage"))}</h2><p>${esc(t(lang, "usage.reading"))}</p></div>`,
});

const stateLine = (entry: { key: string; name: string; state: string; text?: string }, lang: Language): string => {
  if (entry.state === "unread") return shareBar(entry.name, undefined, t(lang, "usage.reading"), { "usage-pending": entry.key });
  if (entry.state === "failed") return `<p><strong>${esc(entry.name)}</strong> ${esc(t(lang, "settings.usage.failed", { reason: entry.text ?? "" }))}</p>`;
  if (entry.state === "text") return `<p><strong>${esc(entry.name)}</strong> ${esc(entry.text ?? "")}</p>`;
  return `<p><strong>${esc(entry.name)}</strong> ${esc(t(lang, "settings.usage.none"))}</p>`;
};

export function usageDialogBody(entries: UsageDialogEntry[], now: number, lang: Language): string {
  const view = usageDialogView(entries, now, lang);
  const groups = view.groups.map((group) => {
    const rows = group.rows.map((row) => `<section class="usagewindow"><h4>${esc(row.label)}</h4>` + row.bars.map((bar) => {
      const provider = group.providers.find((candidate) => candidate.key === bar.key)!;
      if (bar.leftPercent !== undefined) {
        const words = bar.resetReported
          ? t(lang, "usage.leftResets", { percent: bar.leftPercent, resets: bar.resets ?? "" })
          : t(lang, "usage.leftResetUnknown", { percent: bar.leftPercent });
        return shareBar(bar.name, bar.leftPercent, words);
      }
      return provider.state === "windows" ? shareBar(bar.name, undefined, t(lang, "usage.notReported")) : "";
    }).join("") + `</section>`).join("");
    const states = group.providers.filter((provider) => provider.state !== "windows").map((provider) => stateLine(provider, lang)).join("");
    return `<section class="usagegroup"><h3>${esc(TOOL_NAMES[group.tool])}</h3>${rows}${states}</section>`;
  }).join("");
  return `<h2>${esc(t(lang, "shell.usage"))}</h2>${groups || `<p>${esc(t(lang, "usage.noProviders"))}</p>`}`;
}

export { usageDialogView } from "./view.ts";
