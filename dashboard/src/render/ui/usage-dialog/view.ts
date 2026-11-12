import type { Language } from "../../../i18n";
import type { Provider } from "../../../queue/providers/index.ts";
import { PROVIDER_TOOLS, type ProviderTool } from "../../../queue/providers/tools.ts";
import { usageView, type ToolUsage } from "../../pages/settings-page/usage.ts";

export interface UsageDialogEntry { key: string; provider: Provider; usage?: ToolUsage }
export interface UsageDialogBar { key: string; name: string; leftPercent?: number; resets?: string; resetReported?: boolean }
export interface UsageDialogProvider { key: string; name: string; state: "unread" | "windows" | "failed" | "text" | "none"; text?: string }
export interface UsageDialogGroup {
  tool: ProviderTool;
  providers: UsageDialogProvider[];
  rows: { label: string; bars: UsageDialogBar[] }[];
}

export function usageDialogView(entries: UsageDialogEntry[], now: number, lang: Language = "en"): { groups: UsageDialogGroup[] } {
  const groups: UsageDialogGroup[] = [];
  const tools = PROVIDER_TOOLS.filter((tool) => tool !== "opencode");
  tools.sort((left) => left === "codex" ? -1 : 1);
  for (const tool of tools) {
    const toolEntries = entries.filter((entry) => entry.provider.tool === tool);
    if (toolEntries.length === 0) continue;
    const views = toolEntries.map((entry) => usageView(entry.usage, now, lang));
    const labels: string[] = [];
    for (const view of views) if (view.kind === "windows") for (const row of view.rows) if (!labels.includes(row.label)) labels.push(row.label);
    groups.push({
      tool,
      providers: toolEntries.map((entry, index) => {
        const view = views[index]!;
        return { key: entry.key, name: entry.provider.name, state: view.kind, ...(view.kind === "failed" ? { text: view.reason } : view.kind === "text" ? { text: view.text } : {}) };
      }),
      rows: labels.map((label) => ({
        label,
        bars: toolEntries.map((entry, index) => {
          const view = views[index]!;
          const row = view.kind === "windows" ? view.rows.find((candidate) => candidate.label === label) : undefined;
          return { key: entry.key, name: entry.provider.name, ...(row ? { leftPercent: Math.max(0, Math.min(100, 100 - row.usedPercent)), resetReported: row.resets !== undefined, ...(row.resets ? { resets: row.resets } : {}) } : {}) };
        }),
      })),
    });
  }
  return { groups };
}
