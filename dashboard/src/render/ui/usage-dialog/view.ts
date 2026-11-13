import type { Language } from "../../../i18n";
import type { Provider } from "../../../queue/providers/index.ts";
import { PROVIDER_TOOLS, type ProviderTool } from "../../../queue/providers/tools.ts";
import { usageView, type ToolUsage } from "../../pages/settings-page/usage.ts";
import { evenPace, resetMoment, resetsIn, windowSummary, type WindowSummary } from "./pace.ts";
import { windowLength, windowShortName } from "./window.ts";

export interface UsageDialogEntry { key: string; provider: Provider; usage?: ToolUsage }
/** One account's bar in a window's row: the share it has left, the time
 *  until the window starts over and the even-pace share, when known. */
export interface UsageDialogBar { key: string; name: string; leftPercent: number; reset?: number; resetsIn?: string; pace?: number }
export interface UsageDialogProvider { key: string; name: string; state: "unread" | "windows" | "failed" | "text" | "none"; text?: string }
export interface UsageDialogRow { label: string; bars: UsageDialogBar[]; summary: WindowSummary }
export interface UsageDialogGroup {
  tool: ProviderTool;
  providers: UsageDialogProvider[];
  rows: UsageDialogRow[];
}

/** One row per window short name, in first-seen order, holding a bar for
 *  each account that reported that window. An account's state comes from
 *  `usageView()`; its windows are read from the reading itself, since the
 *  view's rows keep the reset time only as text. */
export function usageDialogView(entries: UsageDialogEntry[], now: number, lang: Language = "en"): { groups: UsageDialogGroup[] } {
  const groups: UsageDialogGroup[] = [];
  const tools = PROVIDER_TOOLS.filter((tool) => tool !== "opencode");
  tools.sort((left) => left === "codex" ? -1 : 1);
  for (const tool of tools) {
    const toolEntries = entries.filter((entry) => entry.provider.tool === tool);
    if (toolEntries.length === 0) continue;
    const views = toolEntries.map((entry) => usageView(entry.usage, now, lang));
    const rows: { label: string; bars: UsageDialogBar[] }[] = [];
    toolEntries.forEach((entry, index) => {
      if (views[index]!.kind !== "windows") return;
      for (const window of entry.usage!.windows) {
        const label = windowShortName(window.name, lang);
        let row = rows.find((candidate) => candidate.label === label);
        if (!row) rows.push(row = { label, bars: [] });
        if (row.bars.some((bar) => bar.key === entry.key)) continue;
        const reset = resetMoment(window, now);
        const pace = evenPace(windowLength(window.name), reset, now);
        row.bars.push({
          key: entry.key, name: entry.provider.name,
          leftPercent: Math.max(0, Math.min(100, Math.round(100 - window.usedPercent))),
          ...(reset === undefined ? {} : { reset, resetsIn: resetsIn(reset - now, lang) }),
          ...(pace === undefined ? {} : { pace }),
        });
      }
    });
    groups.push({
      tool,
      providers: toolEntries.map((entry, index) => {
        const view = views[index]!;
        return { key: entry.key, name: entry.provider.name, state: view.kind, ...(view.kind === "failed" ? { text: view.reason } : view.kind === "text" ? { text: view.text } : {}) };
      }),
      rows: rows.map((row) => ({ ...row, summary: windowSummary(row.bars) })),
    });
  }
  return { groups };
}
