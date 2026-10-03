// One panel per AI: where aide installs for it, then three tabs —
// Models, Subscription and Installation — each with its own Check, which
// reads what that tab shows and nothing else, and its own last reading.
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
import { INSTALL_TARGETS, placesOf } from "./places.ts";
import { usageView, type ToolUsage } from "./usage.ts";
import { modelsBlock, type ModelsPanel } from "./models.ts";
import { installationBlock } from "./installation.ts";

export const TOOL_TABS = ["claude", "codex", "copilot", "opencode"] as const;

/** The four tools a check can be asked about, and the shape of the
 *  answer. Declared HERE rather than beside the code that obtains one:
 *  `src/render` may not import `src/serve` (the layering guard in
 *  `test/design`), and the page is what the shape exists for. */
export const CHECKABLE_TOOLS = TOOL_TABS;
export type CheckableTool = (typeof CHECKABLE_TOOLS)[number];

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
  copilot: "Copilot",
  opencode: "OpenCode",
};

/** The tab's opening sentence: where aide installs for this AI, each place
 *  filled in from the table the preflight prints. */
export function toolWhere(lang: Language, tool: CheckableTool, places: Record<string, string>): string {
  return t(lang, `settings.where.${tool}`, places);
}

/** The three tabs inside an AI's tab, in the order they are shown. Each
 *  has its own Check, which reads what that tab shows and nothing else. */
export const TOOL_PARTS = ["models", "subscription", "installation"] as const;
export type ToolPart = (typeof TOOL_PARTS)[number];

export function isToolPart(name: unknown): name is ToolPart {
  return typeof name === "string" && (TOOL_PARTS as readonly string[]).includes(name);
}

/** The open tab inside an AI's tab, off `?aitab=`: Models when none, or an
 *  unknown one, is named. */
export const toolPart = (raw: string | undefined): ToolPart => pickTab(TOOL_PARTS, raw, "models");

/** The body of the "(?)" before one tab's Check, as trusted markup: what
 *  that Check reads for this AI, and what it cannot. */
export function checkHelp(lang: Language, tool: CheckableTool, part: ToolPart): string {
  return esc(t(lang, `settings.checkHelp.${part}.${tool}`));
}

/** How long ago the check was made, so a stale answer reads as one. The
 *  stamp is the moment it was obtained, never the moment the page was
 *  drawn: a check is a measurement, and it stops being true as soon as
 *  anything is installed. */
function stamp(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : when.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** How much of the AI's subscription is used, as the last press of its
 *  Check read it. A reading that failed is muted like a question the check
 *  could not answer: the Installation tab's login line says when to act. */
function usageBlock(usage: ToolUsage | undefined, now: number): string {
  const view = usageView(usage, now);
  const read = (at: string) => `<p class="muted small">Usage read ${esc(stamp(at))}</p>`;
  switch (view.kind) {
    case "unread":
      return `<p class="muted">Usage not read yet.</p>`;
    case "failed":
      return read(view.at) + `<p class="muted">The usage could not be read: ${esc(view.reason)}</p>`;
    case "noSource":
      return `<p class="muted">The board does not read this AI's usage: its command line has no command that reports it.</p>`;
    case "none":
      return read(view.at) + `<p class="muted">This AI reports no usage windows.</p>`;
    case "text":
      return read(view.at) + `<pre class="checkoutput">${esc(view.text)}</pre>`;
    case "windows":
      return read(view.at) + facts(view.rows.map((row) => ({
        label: esc(row.label),
        value: esc(`${row.usedPercent}% used${row.resets ? ` · resets ${row.resets}` : ""}`),
      })));
  }
}

/** What the open tab shows: the reading its own Check made. */
function partBody(
  part: ToolPart,
  tool: CheckableTool,
  readings: { check?: ToolCheck; usage?: ToolUsage; models: ModelsPanel },
  now: number,
  lang: Language,
): string {
  const { check, usage, models } = readings;
  if (part === "installation") return installationBlock(check, check ? stamp(check.at) : "", lang);
  if (part === "subscription") return usageBlock(usage, now);
  return modelsBlock(tool, models, models.reading ? stamp(models.reading.at) : "", lang, TOOL_TAB_LABELS[tool]);
}

/** The panel behind one AI's tab. `check`, `usage` and `models.reading`
 *  are the last answers obtained for this tool in this server's lifetime,
 *  or absent when none has been asked for: nothing is run because a page
 *  was opened. `now` is the page's own time, which a reset is written
 *  against. `models` also carries the live choices the reading is set
 *  against. `lang` is the reader's, for the sentence, the tabs and the
 *  "(?)". `part` is the open tab, which is the only one drawn. */
export function toolPanel(
  tool: CheckableTool,
  check: ToolCheck | undefined,
  usage?: ToolUsage,
  now: number = Date.now(),
  models: ModelsPanel = {},
  lang: Language = "en",
  part: ToolPart = "models",
): string {
  const id = `check-${tool}-${part}`;
  return (
    `<section class="toolpanel" data-tool="${esc(tool)}">` +
    `<p>${esc(toolWhere(lang, tool, placesOf(INSTALL_TARGETS, tool)))}</p>` +
    tabBar(TOOL_PARTS, (p) => `/settings?tab=${tool}&aitab=${p}`, part, {}, "", {
      label: (p) => t(lang, `settings.part.${p}`),
      data: { aitabs: "" },
    }) +
    // Posted by the page script, which loads the same tab again with the
    // answer drawn below; a refusal stays in the form's own line.
    buttonForm({
      id,
      action: "/api/queue/settings/check",
      hook: "configactions reloadform",
      hidden: { tool, part },
      before: helpPopover(t(lang, "settings.checkHelpTitle"), checkHelp(lang, tool, part)),
      button: { id: `${id}-run`, label: "Check", variant: "primary", pending: "checking…" },
      after: messageSlot("refused"),
    }) +
    partBody(part, tool, { check, usage, models }, now, lang) +
    `</section>`
  );
}
