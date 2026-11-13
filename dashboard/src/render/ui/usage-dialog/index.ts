import { t, type Language } from "../../../i18n";
import { TOOL_NAMES } from "../../../queue/providers/tools.ts";
import { headerMenu, shareBar, usageBar } from "../components";
import { ICON_USAGE, TOOL_ICONS } from "../components/icons.ts";
import { esc } from "../html.ts";
import type { Trend } from "./pace.ts";
import type { UsageDialogBar, UsageDialogEntry, UsageDialogRow } from "./view.ts";
import { usageDialogView } from "./view.ts";

export const USAGE_DIALOG_ROUTE = "/api/queue/settings/providers/usage";

/** The providers the panel shows, each with the reading the server keeps of
 *  it: read live every time a page is drawn. Set by every server when it
 *  starts. Unset, or answering nothing, the panel says only that usage is
 *  being read. It lives here because `src/render` may not import `src/serve`. */
let entriesNow: (() => UsageDialogEntry[] | undefined) | undefined;

export function setUsageEntries(source: (() => UsageDialogEntry[] | undefined) | undefined): void {
  entriesNow = source;
}

export const usageButton = (lang: Language): string => {
  const entries = entriesNow?.();
  const body = entries
    ? usageDialogBody(entries, Date.now(), lang)
    : `<h2>${esc(t(lang, "shell.usage"))}</h2><p>${esc(t(lang, "usage.reading"))}</p>`;
  return headerMenu({
    label: t(lang, "shell.usage"), icon: ICON_USAGE, id: "usage-dialog",
    data: { src: USAGE_DIALOG_ROUTE }, panelClass: "usagepanel",
    content: `<div data-usage-content>${body}</div>`,
  });
};

const stateLine = (entry: { key: string; name: string; state: string; text?: string }, lang: Language): string => {
  if (entry.state === "unread") return shareBar(entry.name, undefined, t(lang, "usage.reading"));
  if (entry.state === "failed") return `<p><strong>${esc(entry.name)}</strong> ${esc(t(lang, "settings.usage.failed", { reason: entry.text ?? "" }))}</p>`;
  if (entry.state === "text") return `<p><strong>${esc(entry.name)}</strong> ${esc(entry.text ?? "")}</p>`;
  return `<p><strong>${esc(entry.name)}</strong> ${esc(t(lang, "settings.usage.none"))}</p>`;
};

const TREND_MARKS: Record<Trend, string> = { faster: "↑", slower: "↓", even: "=" };

/** A window's name, the mean share left with its trend, and how much it
 *  rises at the earliest reset. */
const summary = (row: UsageDialogRow, lang: Language): string => {
  const { leftPercent, trend, rise } = row.summary;
  const mark = trend ? ` <span data-trend="${trend}" title="${esc(t(lang, `usage.trend.${trend}`))}">${TREND_MARKS[trend]}</span>` : "";
  return `<div class="usagesummary"><h4>${esc(row.label)}</h4>` +
    `<p><strong>${leftPercent}%</strong> ${esc(t(lang, "usage.leftWord"))}${mark}</p>` +
    (rise === undefined ? "" : `<p data-rise title="${esc(t(lang, "usage.riseTitle", { percent: rise }))}">↻ +${rise}%</p>`) +
    `</div>`;
};

const bar = (bar: UsageDialogBar, lang: Language): string => usageBar({
  name: bar.name, value: bar.leftPercent,
  label: `${bar.name}: ${t(lang, "usage.left", { percent: bar.leftPercent })}`,
  ...(bar.resetsIn ? { resets: bar.resetsIn } : {}),
  ...(bar.pace === undefined ? {} : { pace: bar.pace, paceTitle: t(lang, "usage.paceTitle", { percent: bar.pace }) }),
});

export function usageDialogBody(entries: UsageDialogEntry[], now: number, lang: Language): string {
  const view = usageDialogView(entries, now, lang);
  const groups = view.groups.map((group) => {
    const rows = group.rows.map((row) =>
      `<section class="usagewindow">${summary(row, lang)}<div class="usagebars">${row.bars.map((b) => bar(b, lang)).join("")}</div></section>`).join("");
    const states = group.providers.filter((provider) => provider.state !== "windows").map((provider) => stateLine(provider, lang)).join("");
    const icon = `<span class="providericon" aria-hidden="true">${TOOL_ICONS[group.tool]}</span>`;
    return `<section class="usagegroup"><h3>${icon}${esc(TOOL_NAMES[group.tool])}</h3>${rows}${states}</section>`;
  }).join("");
  return `<h2>${esc(t(lang, "shell.usage"))}</h2>${groups || `<p>${esc(t(lang, "usage.noProviders"))}</p>`}`;
}

export { usageDialogView } from "./view.ts";
