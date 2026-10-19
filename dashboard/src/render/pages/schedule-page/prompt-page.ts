// A scheduled job's prompt file on a page of its own: the file as the
// default branch of the board's checkout has it, drawn read-only as
// Markdown by the same viewer the spec page's document tabs use — or one
// sentence saying it cannot be read. The route decides what is read; this
// only draws it.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { t, type Language } from "../../../i18n";
import { backLink, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { viewerPair } from "../spec-page/panels.ts";
import { schedulePromptPath, scheduleSettingsPath } from "./tabs.ts";

export interface SchedulePromptPageOptions {
  project: string;
  entry: ScheduleEntry;
  /** The file's text off the default branch; null when it cannot be read. */
  text: string | null;
  /** The read-only viewer's bundle, attached only when there is text to draw. */
  viewerSrc: string;
  lang: Language;
  currentUrl?: string;
}

export function renderSchedulePromptPage(nav: NavEntry[], generatedAt: string, o: SchedulePromptPageOptions): string {
  const settings = scheduleSettingsPath(o.project, o.entry.name);
  // The job is a link to its Settings tab, placed into the sentence after
  // escaping, as `renderReportPanel` places its time.
  const MARK = "\u0000";
  const job = `<a href="${esc(settings)}">${esc(`${o.project}:${o.entry.name}`)}</a>`;
  const of = esc(t(o.lang, "schedule.promptOfJob", { job: MARK })).replace(MARK, job);
  const body =
    `<div class="doc">` +
    backLink(settings, o.entry.prompt) +
    `<p class="muted">${of}</p>` +
    (o.text !== null
      ? viewerPair(o.text)
      : rowMessage("failed", t(o.lang, "schedule.promptUnreadable", { file: o.entry.prompt, project: o.project }), { tag: "p" })) +
    `</div>`;
  return pageShell(o.entry.prompt, nav, schedulePromptPath(o.project, o.entry.name), body, generatedAt, {
    hideHeading: true,
    lang: o.lang,
    currentUrl: o.currentUrl,
    ...(o.text !== null ? { scriptSrc: o.viewerSrc } : {}),
  });
}
