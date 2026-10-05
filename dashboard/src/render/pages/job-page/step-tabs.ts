// What an opened step shows under its facts: a strip of three tabs (Log,
// Changed files, Errors) and one box holding the current tab's content.
// The tab is `?steptab=` in the address, like the open step is `?step=`:
// a page that follows a running step is asked for again in place, and one
// opened afresh reads its address, so a choice held in a widget would snap
// back to Log.

import { t, type Language } from "../../../i18n";
import { pickTab, tabBar } from "../../ui/tabs.ts";
import { esc } from "../../ui/html.ts";
import type { LogPart } from "../../../queue/parse-stream";
import type { JobStepResultView } from "./types.ts";

const STEP_TABS = ["log", "files", "errors"] as const;
export type StepTab = (typeof STEP_TABS)[number];

/** The tab an address names; Log for none, or one that is none of the three. */
export const resolveStepTab = (raw: string | undefined): StepTab => pickTab(STEP_TABS, raw, "log");

/** What the panel draws: a finished step's view already is this, and a
 *  running step's is built from its live log with `running` set. */
export type StepPanelData = Pick<JobStepResultView, "logs" | "errors" | "aiModel" | "changedFiles" | "terminalReason"> & {
  running?: boolean;
};

/** Who writes the part that follows, as its separator line names them.
 *  The phase's row under the specs list draws the same words. */
export function logPartWriter(part: LogPart, aiModel: string | undefined, lang: Language): string {
  if (part.by === "subagent") return t(lang, "job.logSubagent", { name: part.name });
  return {
    "aide-before": t(lang, "job.logAideBefore"),
    "aide-after": t(lang, "job.logAideAfter"),
    aide: t(lang, "job.logAide"),
    ai: aiModel ? t(lang, "job.logAi", { model: aiModel }) : t(lang, "job.logAiPlain"),
  }[part.by];
}

/** A part's lines as drawn. A subagent's are what it was asked, its own work
 *  and what it answered; one whose work could not be read is one sentence
 *  saying so. The model's text arrives escaped; a name and a thread id do
 *  not, and are escaped here. */
export function logPartLines(part: LogPart, lang: Language): string[] {
  if (part.by !== "subagent") return part.lines;
  if (part.unread) return [t(lang, "job.subagentUnread", { thread: esc(part.unread.thread) })];
  return [
    part.asked !== undefined ? t(lang, "job.subagentAsked", { text: part.asked }) : t(lang, "job.subagentAskedTask", { name: esc(part.name) }),
    ...part.lines,
    part.answer !== undefined ? t(lang, "job.subagentAnswered", { text: part.answer }) : t(lang, "job.subagentNoAnswer"),
  ];
}

/** The parts a Log draws, each as its separator words and its lines; a part
 *  with nothing to draw is left out. Both the Log tab and the phase's row
 *  draw these. */
export function drawnParts(parts: LogPart[], aiModel: string | undefined, lang: Language): { writer: string; lines: string[] }[] {
  return parts
    .map((part) => ({ writer: logPartWriter(part, aiModel, lang), lines: logPartLines(part, lang) }))
    .filter((drawn) => drawn.lines.length > 0);
}

function logTab(r: StepPanelData, lang: Language): string {
  const parts = drawnParts(r.logs ?? [], r.aiModel, lang);
  if (parts.length > 0) {
    const body = parts.map((part) => `<span class="muted">— ${esc(part.writer)} —</span>\n${part.lines.join("\n")}`).join("\n");
    return `<pre class="specfile">${body}</pre>`;
  }
  if (r.terminalReason === "refused") {
    return `<p class="muted">This step was refused before it started, so nothing ran and no transcript exists.</p>`;
  }
  return `<p class="muted">Nothing has been captured from this step.</p>`;
}

function filesTab(r: StepPanelData, lang: Language): string {
  if (r.running) return `<p class="muted">${esc(t(lang, "job.filesRunning"))}</p>`;
  if (!r.changedFiles) return `<p class="muted">${esc(t(lang, "job.filesNotKnown"))}</p>`;
  if (r.changedFiles.length === 0) return `<p class="muted">${esc(t(lang, "job.noChangedFiles"))}</p>`;
  return `<ul>${r.changedFiles
    .map((f) =>
      f.binary
        ? `<li>${esc(f.path)} <span class="muted small">binary</span></li>`
        : `<li>${esc(f.path)} +${f.added} -${f.removed}</li>`,
    )
    .join("")}</ul>`;
}

function errorsTab(r: StepPanelData, lang: Language): string {
  return r.errors && r.errors.length > 0
    ? `<pre class="specfile">${r.errors.join("\n")}</pre>`
    : `<p class="muted">${esc(t(lang, "job.noErrors"))}</p>`;
}

/** The strip and the box. `refusal` is the merge's own refusal: it is the
 *  newest thing that happened to the step, and the transcript below it is
 *  of the run that succeeded, so it stands above everything else. The
 *  box's one child is what lets `column-reverse` open it at its end, where
 *  the last thing in the tab is. */
export function stepPanel(
  r: StepPanelData,
  o: { tabHref?: string; key: string; steptab?: string; refusal?: string; lang: Language },
): string {
  const current = resolveStepTab(o.steptab);
  const count = r.changedFiles && !r.running ? ` (${r.changedFiles.length})` : "";
  const label: Record<StepTab, string> = {
    log: t(o.lang, "job.tabLog"),
    files: `${t(o.lang, "job.tabFiles")}${count}`,
    errors: t(o.lang, "job.tabErrors"),
  };
  // "Changed files (0)" keeps its count through the label: `counts` drops a zero.
  const link = (tab: StepTab): string | undefined => (o.tabHref ? `${o.tabHref}&step=${o.key}&steptab=${tab}` : undefined);
  const strip = tabBar(STEP_TABS, link, current, {}, "", { label: (tab) => label[tab] });
  const content = { log: logTab, files: filesTab, errors: errorsTab }[current](r, o.lang);
  const merge = o.refusal ? `<pre class="specfile">${esc(o.refusal)}</pre>` : "";
  return `${merge}${strip}<div class="logbox"><div>${content}</div></div>`;
}
