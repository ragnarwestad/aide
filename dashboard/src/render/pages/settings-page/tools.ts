// One panel per AI: what it is, what can be asked about it, and the
// answer the last check gave.
//
// The panel deliberately does NOT restate where aide installs each
// tool's files. `aide-preflight` knows that, prints it, and is the one
// place it is written down; the check's own output is what a reader
// sees. What this file holds is the part the script cannot say: which
// questions are answerable for which tool, and why.

import { esc } from "../../ui/html.ts";
import { btn } from "../../ui/components";

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

/** What each tool is, in the one sentence a reader needs before pressing
 *  Check, and what the check will and will not be able to tell them. The
 *  second half matters: three of the four CLIs cannot be asked which
 *  models they accept, and a page that quietly skipped that would read
 *  as if the check had covered it. */
const TOOL_NOTES: Record<CheckableTool, { what: string; canCheck: string; cannotCheck: string }> = {
  claude: {
    what: "Claude Code reads aide's skills, rules and agents from its own directory under your home.",
    canCheck: "whether the command line is installed and which version, whether it is logged in, where each piece of aide lands and whether it is there, and whether the installed files still match this repository",
    cannotCheck: "which models it accepts. Claude Code has no command that lists them, so a model name is only known to be wrong when a run fails on it.",
  },
  codex: {
    what: "Codex reads aide's generated instructions file and shares the skills directory with Copilot.",
    canCheck: "whether the command line is installed and which version, whether it is logged in, where each piece of aide lands and whether it is there, and whether the installed files still match this repository",
    cannotCheck: "which models it accepts. Codex has no command that lists them.",
  },
  copilot: {
    what: "Copilot reads aide's generated instructions file and shares the skills directory with Codex.",
    canCheck: "whether the command line is installed and which version, where each piece of aide lands and whether it is there, and whether the installed files still match this repository",
    cannotCheck: "whether it is logged in, or which models it accepts. The Copilot CLI has a command for neither.",
  },
  opencode: {
    what: "OpenCode brings no model of its own: every model belongs to a provider and is named provider/model. It finds aide's skills where they already are, so aide installs only the instructions file for it.",
    canCheck: "everything the others can, and one more besides: whether every model configured on this server still appears in its provider's own list. A provider IS the login here, since OpenCode reaches every model through one",
    cannotCheck: "",
  },
};

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
    return `<p class="rowmsg failed">${esc(check.error)}</p>`;
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

/** The panel behind one AI's tab. `check` is the last answer obtained
 *  for this tool in this server's lifetime, or absent when none has been
 *  asked for: nothing is run because a page was opened. */
export function toolPanel(tool: CheckableTool, check: ToolCheck | undefined, token?: string): string {
  const note = TOOL_NOTES[tool];
  const cannot = note.cannotCheck
    ? `<p class="muted">The check cannot tell you ${esc(note.cannotCheck)}</p>`
    : "";
  const tokenField = token
    ? `<input type="hidden" name="token" value="${esc(token)}">`
    : "";
  return (
    `<section class="toolpanel" data-tool="${esc(tool)}">` +
    `<p>${esc(note.what)}</p>` +
    `<p class="muted">The check tells you ${esc(note.canCheck)}.</p>` +
    cannot +
    `<form method="post" action="/api/queue/settings/check" id="check-${esc(tool)}">` +
    tokenField +
    `<input type="hidden" name="tool" value="${esc(tool)}">` +
    `<div class="configactions">` +
    btn({ id: `check-${tool}-run`, label: "Check", variant: "primary", pending: "checking…" }) +
    `</div></form>` +
    (check ? resultBlock(check) : `<p class="muted">Not checked yet.</p>`) +
    `</section>`
  );
}
