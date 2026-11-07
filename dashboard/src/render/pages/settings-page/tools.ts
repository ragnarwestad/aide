// What a provider's page reads of its tool: the shape of a check, the
// sentence naming where aide installs for the tool, and the usage block.
//
// The places in the sentence come from
// core/scripts/lib/install-targets.txt (`places.ts`), the table
// `aide-preflight` prints its own place lines from, so the sentence and
// the check's output cannot name different places. What this file adds
// is the part the script cannot say: which questions are answerable for
// which tool, and why.

import { t, type Language } from "../../../i18n";
import type { BoardMessage } from "../../../i18n/message.ts";
import { esc } from "../../ui/html.ts";
import { facts } from "../../ui/components";
import { PROVIDER_TOOLS, type ProviderTool } from "../../../queue/providers/index.ts";
import { usageView, type ToolUsage } from "./usage.ts";

/** The tools a check can be asked about — the ones a provider can be for —
 *  and the shape of the answer. Declared HERE rather than beside the code
 *  that obtains one: `src/render` may not import `src/serve` (the layering
 *  guard in `test/design`), and the page is what the shape exists for. */
export const CHECKABLE_TOOLS = PROVIDER_TOOLS;
export type CheckableTool = ProviderTool;

export interface ExtraCheck {
  question: string;
  /** true, false, or null when the answer could not be obtained - which
   *  is a different thing from "no", and is never shown as one. */
  ok: boolean | null;
  detail: string;
  /** What is wrong, in a few words, when `ok` is false — what the notice
   *  on every page says. Absent, the question itself is said. */
  problem?: string;
  /** The answer as one sentence, stored without a language. Set, the
   *  Installation tab draws the entry as this sentence alone, with
   *  `detail` after it when there is one: no mark and no question. */
  answer?: BoardMessage;
  /** The provider this answer is for, when the check asked a provider's
   *  login rather than the tool's own. */
  provider?: string;
  /** When the login ends, as an ISO time, where the tool says. */
  ends?: string;
  /** The plan the login is on, where the tool says (Claude Code's
   *  subscription: "Max", "Team"). */
  plan?: string;
}

export interface ToolCheck {
  tool: CheckableTool;
  /** When this answer was obtained. A check is a moment, not a state:
   *  what it says stops being true the next time anything is installed. */
  at: string;
  found: boolean;
  /** The names of the places (`install-targets.txt`) that do not exist on
   *  this host. */
  missing?: string[];
  /** Each place's path as the host shows it, by the place's name: where
   *  `$XDG_CONFIG_HOME` moves a place, the moved path. */
  paths?: Record<string, string>;
  /** Whether the installed files are behind the repository they came from. */
  behind?: boolean;
  extra: ExtraCheck[];
  /** Set when the script could not be run at all, rather than running
   *  and reporting a problem. The two read differently on the page. */
  error?: string;
}

export const TOOL_TAB_LABELS: Record<CheckableTool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

/** How long ago the check was made, so a stale answer reads as one. The
 *  stamp is the moment it was obtained, never the moment the page was
 *  drawn: a check is a measurement, and it stops being true as soon as
 *  anything is installed. */
export function stamp(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : when.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** How much of the provider's subscription is used, as read when its page
 *  opened. A reading that failed is muted like a question the check could
 *  not answer. */
export function usageBlock(usage: ToolUsage | undefined, now: number, lang: Language): string {
  const view = usageView(usage, now, lang);
  const read = (at: string) => `<p class="muted small">${esc(t(lang, "settings.usage.readAt", { at: stamp(at) }))}</p>`;
  switch (view.kind) {
    case "unread":
      return `<p class="muted">${esc(t(lang, "settings.usage.unread"))}</p>`;
    case "failed":
      return read(view.at) + `<p class="muted">${esc(t(lang, "settings.usage.failed", { reason: view.reason }))}</p>`;
    case "none":
      return read(view.at) + `<p class="muted">${esc(t(lang, "settings.usage.none"))}</p>`;
    case "text":
      return read(view.at) + `<pre class="checkoutput">${esc(view.text)}</pre>`;
    case "windows":
      return read(view.at) + facts(view.rows.map((row) => ({
        label: esc(row.label),
        value: esc(row.resets
          ? t(lang, "settings.usage.usedResets", { percent: row.usedPercent, resets: row.resets })
          : t(lang, "settings.usage.used", { percent: row.usedPercent })),
      })));
  }
}
