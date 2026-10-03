// One panel per AI: where aide installs for it, what can be asked about
// it, and the answer the last check gave.
//
// The places in the opening sentence come from
// core/scripts/lib/install-targets.txt (`places.ts`), the table
// `aide-preflight` prints its own place lines from, so the sentence and
// the check's output cannot name different places. What this file adds
// is the part the script cannot say: which questions are answerable for
// which tool, and why.

import { t, type Language, type TranslationKey } from "../../../i18n";
import { esc } from "../../ui/html.ts";
import { buttonForm, facts, helpPopover, messageSlot, rowMessage } from "../../ui/components";
import { INSTALL_TARGETS, placesOf } from "./places.ts";
import { usageView, type ToolUsage } from "./usage.ts";
import { modelsBlock, type ModelsPanel } from "./models.ts";

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

/** What a press of Check finds out, and what it cannot. The second half
 *  matters: Copilot cannot be asked which models it accepts, and help
 *  that quietly skipped that would read as if the check had covered it. */
const CANNOT: Partial<Record<CheckableTool, TranslationKey>> = { copilot: "settings.checkCannot.copilot" };

/** The body of the "(?)" before Check, as trusted markup. */
export function checkHelp(lang: Language, tool: CheckableTool): string {
  const cannot = CANNOT[tool];
  return esc(t(lang, `settings.checkCan.${tool}`)) + (cannot ? `<br><br>${esc(t(lang, cannot))}` : "");
}

const mark = (ok: boolean | null): string =>
  ok === null ? "?" : ok ? "OK" : "FAIL";

const markClass = (ok: boolean | null): string =>
  ok === null ? "muted" : ok ? "ok" : "failed";

/** How long ago the check was made, so a stale answer reads as one. The
 *  stamp is the moment it was obtained, never the moment the page was
 *  drawn: a check is a measurement, and it stops being true as soon as
 *  anything is installed. */
function stamp(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : when.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function resultBlock(check: ToolCheck): string {
  if (check.error) {
    return rowMessage("failed", check.error, { tag: "p" });
  }
  const extra = check.extra.length
    ? `<ul class="checklist">` +
      check.extra
        .map(
          (e) =>
            `<li><span class="${markClass(e.ok)}">${mark(e.ok)}</span> ` +
            `${esc(e.question)} ${esc(e.detail)}</li>`,
        )
        .join("") +
      `</ul>`
    : "";
  const ran = check.commands?.length
    ? `<p class="muted small">Ran:</p><pre class="checkoutput">${esc(check.commands.join("\n"))}</pre>`
    : "";
  return (
    `<p class="muted small">Checked ${esc(stamp(check.at))}</p>` +
    extra +
    ran +
    `<pre class="checkoutput">${esc(check.lines.join("\n"))}</pre>`
  );
}

/** How much of the AI's subscription is used, as the last press of Check
 *  read it. A reading that failed is muted like a question the check
 *  could not answer: the login line above already says when to act. */
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

/** The panel behind one AI's tab. `check`, `usage` and `models.reading`
 *  are the last answers obtained for this tool in this server's lifetime,
 *  or absent when none has been asked for: nothing is run because a page
 *  was opened. `now` is the page's own time, which a reset is written
 *  against. `models` also carries the live choices the reading is set
 *  against. `lang` is the reader's, for the sentence and the "(?)". */
export function toolPanel(
  tool: CheckableTool,
  check: ToolCheck | undefined,
  usage?: ToolUsage,
  now: number = Date.now(),
  models: ModelsPanel = {},
  lang: Language = "en",
): string {
  return (
    `<section class="toolpanel" data-tool="${esc(tool)}">` +
    `<p>${esc(toolWhere(lang, tool, placesOf(INSTALL_TARGETS, tool)))}</p>` +
    // Posted by the page script, which loads the tab again with the
    // answer drawn below; a refusal stays in the form's own line.
    buttonForm({
      id: `check-${tool}`,
      action: "/api/queue/settings/check",
      hook: "configactions reloadform",
      hidden: { tool },
      before: helpPopover(t(lang, "settings.checkHelpTitle"), checkHelp(lang, tool)),
      button: { id: `check-${tool}-run`, label: "Check", variant: "primary", pending: "checking…" },
      after: messageSlot("refused"),
    }) +
    (check ? resultBlock(check) : `<p class="muted">Not checked yet.</p>`) +
    usageBlock(usage, now) +
    modelsBlock(tool, models, models.reading ? stamp(models.reading.at) : "") +
    `</section>`
  );
}
