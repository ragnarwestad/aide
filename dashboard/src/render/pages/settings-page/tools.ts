// The tool's panel on a provider's page: where aide installs for the tool,
// one Check, then two tabs — Models and Installation — each showing its own
// last reading, which that one Check made along with the other.
//
// The places in the opening sentence come from
// core/scripts/lib/install-targets.txt (`places.ts`), the table
// `aide-preflight` prints its own place lines from, so the sentence and
// the check's output cannot name different places. What this file adds
// is the part the script cannot say: which questions are answerable for
// which tool, and why.

import { t, type Language } from "../../../i18n";
import type { BoardMessage } from "../../../i18n/message.ts";
import { esc } from "../../ui/html.ts";
import { buttonForm, facts, helpPopover, messageSlot } from "../../ui/components";
import { pickTab, tabBar } from "../../ui/tabs.ts";
import { PROVIDER_TOOLS, type ProviderTool } from "../../../queue/providers/index.ts";
import { INSTALL_TARGETS, placesOf } from "./places.ts";
import { usageView, type ToolUsage } from "./usage.ts";
import { modelsBlock, type ModelsPanel } from "./models.ts";
import { installationBlock } from "./installation.ts";

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
  /** Every command the check ran, in order, exactly as it ran them.
   *  Shown so a reader who needs to go further can run the same thing
   *  in a terminal and see more than a page can show. */
  commands?: string[];
  /** When this answer was obtained. A check is a moment, not a state:
   *  what it says stops being true the next time anything is installed. */
  at: string;
  found: boolean;
  /** What the preflight printed, one line per entry, colour removed. */
  lines: string[];
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

/** The tab's opening sentence: where aide installs for this AI, each place
 *  filled in from the table the preflight prints. */
export function toolWhere(lang: Language, tool: CheckableTool, places: Record<string, string>): string {
  return t(lang, `settings.where.${tool}`, places);
}

/** The two tabs a provider's page has under its Check, in the order they
 *  are shown. The one Check above them reads both. */
export const TOOL_PARTS = ["models", "installation"] as const;

export type ToolPart = (typeof TOOL_PARTS)[number];

/** The tabs under a provider's Check. */
export const toolParts = (_tool: CheckableTool): readonly ToolPart[] => TOOL_PARTS;

/** The open tab under the Check, off `?aitab=`: Models when none, or one
 *  that does not exist, is named. */
export const toolPart = (raw: string | undefined, tool?: CheckableTool): ToolPart =>
  pickTab(tool ? toolParts(tool) : TOOL_PARTS, raw, "models");

/** The body of the "(?)" before the Check, as trusted markup: that one
 *  press reads both tabs, then what it reads for this tool on each. */
export function checkHelp(lang: Language, tool: CheckableTool): string {
  const parts = TOOL_PARTS.map((part) =>
    `${t(lang, `settings.part.${part}`)}: ${t(lang, `settings.checkHelp.${part}.${tool}`)}`);
  return esc([t(lang, "settings.checkHelpAll"), ...parts].join(" "));
}

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

/** What the open tab shows: the reading the last press of Check made. */
function partBody(
  part: ToolPart,
  tool: CheckableTool,
  readings: { check?: ToolCheck; models: ModelsPanel },
  lang: Language,
): string {
  const { check, models } = readings;
  if (part === "installation") return installationBlock(check, check ? stamp(check.at) : "", lang);
  return modelsBlock(tool, models, models.reading ? stamp(models.reading.at) : "", lang, TOOL_TAB_LABELS[tool]);
}

/** The tool's panel on the page of the provider `provider.key`. `check` and
 *  `models.reading` are the last answers obtained for the tool in this
 *  server's lifetime, or absent when none has been asked for: nothing is run
 *  because a page was opened. `models` also carries the live choices the
 *  reading is set against. `lang` is the reader's, for the sentence, the
 *  tabs and the "(?)". `part` is the open tab, which is the only one drawn. */
export function toolPanel(
  provider: { key: string; tool: CheckableTool },
  check: ToolCheck | undefined,
  models: ModelsPanel = {},
  lang: Language = "en",
  part: ToolPart = "models",
): string {
  const { key, tool } = provider;
  const id = "check-provider";
  return (
    `<section class="toolpanel" data-tool="${esc(tool)}">` +
    `<p>${esc(toolWhere(lang, tool, placesOf(INSTALL_TARGETS, tool)))}</p>` +
    // Posted by the page script, which loads the same tab again with the
    // answers drawn below; a refusal stays in the form's own line.
    buttonForm({
      id,
      action: "/api/queue/settings/check",
      hook: "configactions reloadform",
      hidden: { key },
      before: helpPopover(t(lang, "settings.checkHelpTitle"), checkHelp(lang, tool)),
      button: { id: `${id}-run`, label: t(lang, "settings.checkButton"), variant: "primary", pending: t(lang, "settings.checking") },
      after: messageSlot("refused"),
    }) +
    tabBar(toolParts(tool), (p) => `/settings?tab=providers&provider=${encodeURIComponent(key)}&aitab=${p}`, part, {}, "", {
      lang,
      label: (p) => t(lang, `settings.part.${p}`),
      data: { aitabs: "" },
    }) +
    partBody(part, tool, { check, models }, lang) +
    `</section>`
  );
}
