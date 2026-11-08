// How much of a provider's subscription is used, as its page shows it: the
// shape of one reading and the decision about what the tab says of it.
// Declared here rather than beside the code that reads it, for the same
// reason `ToolCheck` is: `src/render` may not import `src/serve`.

import { capitalizeFirst, when, windowPhrase } from "../../ui/job-state/provider-limit.ts";
import type { ProviderLimitWindow } from "../../../queue/types.ts";
import type { Language } from "../../../i18n";
import type { CheckableTool } from "./tools.ts";

/** One window as the tool reported it. `resets` is the tool's own words
 *  for when it starts over, kept as they came: Claude's text names a day
 *  with no year, so it is not turned into a date. */
export interface UsageWindow extends ProviderLimitWindow {
  resets?: string;
}

/** One reading of a provider's usage, made when its page opened. */
export interface ToolUsage {
  tool: CheckableTool;
  /** When the reading was made. Like a check, it is a moment. */
  at: string;
  windows: UsageWindow[];
  /** What the tool printed, when none of it could be read as a window. */
  text?: string;
  /** Set when the usage could not be read at all. Never shown as none. */
  error?: string;
}

export interface UsageRow {
  label: string;
  usedPercent: number;
  resets?: string;
}

export type UsageView =
  | { kind: "unread" }
  | { kind: "failed"; at: string; reason: string }
  | { kind: "windows"; at: string; rows: UsageRow[] }
  | { kind: "text"; at: string; text: string }
  | { kind: "none"; at: string };

/** The names the board gives a window itself (`five_hour`, `seven_day`,
 *  `<n>_minutes`). Any other name is the tool's own label. */
const BOARD_NAME = /^(five_hour|seven_day|\d+_minutes)$/;

function row(window: UsageWindow, now: number, lang: Language): UsageRow {
  const label = BOARD_NAME.test(window.name) ? capitalizeFirst(windowPhrase(window.name, lang)) : window.name;
  const resets = window.resets ?? (window.resetsAt ? when(window.resetsAt, now, lang) : undefined);
  return { label, usedPercent: window.usedPercent, ...(resets ? { resets } : {}) };
}

/** What the tab says of a reading. A reading that failed comes before
 *  everything else it carries, and only a reading that succeeded with
 *  neither windows nor text is "none". */
export function usageView(usage: ToolUsage | undefined, now: number, lang: Language = "en"): UsageView {
  if (!usage) return { kind: "unread" };
  const at = usage.at;
  if (usage.error) return { kind: "failed", at, reason: usage.error };
  if (usage.windows.length > 0) return { kind: "windows", at, rows: usage.windows.map((w) => row(w, now, lang)) };
  if (usage.text) return { kind: "text", at, text: usage.text };
  return { kind: "none", at };
}
