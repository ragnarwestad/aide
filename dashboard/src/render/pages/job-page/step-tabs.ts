// What an opened step shows under its facts: a strip of three tabs (Log,
// Changed files, Errors) and one box holding the current tab's content.
// The tab is `?steptab=` in the address, like the open step is `?step=`:
// the page reloads itself every ten seconds while a step runs, so a choice
// held in a widget would snap back to Log on the next reload.

import { t, type Language } from "../../../i18n";
import { pickTab } from "../../ui/tabs.ts";
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

/** Each part opens with one separator line naming who writes what follows. */
function separator(part: LogPart, r: StepPanelData, lang: Language): string {
  const words = {
    "aide-before": t(lang, "job.logAideBefore"),
    "aide-after": t(lang, "job.logAideAfter"),
    aide: t(lang, "job.logAide"),
    ai: r.aiModel ? t(lang, "job.logAi", { model: r.aiModel }) : t(lang, "job.logAiPlain"),
  }[part.by];
  return `<span class="muted">— ${esc(words)} —</span>`;
}

function logTab(r: StepPanelData, lang: Language): string {
  const parts = (r.logs ?? []).filter((part) => part.lines.length > 0);
  if (parts.length > 0) {
    const body = parts.map((part) => `${separator(part, r, lang)}\n${part.lines.join("\n")}`).join("\n");
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
  const strip = STEP_TABS.map((tab) => {
    const here = tab === current ? ` aria-current="true"` : "";
    return o.tabHref
      ? `<a class="tab" data-nav data-goto href="${o.tabHref}&step=${esc(o.key)}&steptab=${tab}"${here}>${esc(label[tab])}</a>`
      : `<span class="tab"${here}>${esc(label[tab])}</span>`;
  }).join("");
  const content = { log: logTab, files: filesTab, errors: errorsTab }[current](r, o.lang);
  const merge = o.refusal ? `<pre class="specfile">${esc(o.refusal)}</pre>` : "";
  return `${merge}<nav class="tabbar subtabs">${strip}</nav><div class="logbox"><div>${content}</div></div>`;
}
