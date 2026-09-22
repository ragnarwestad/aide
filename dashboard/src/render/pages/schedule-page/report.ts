// Spec 495: the panel on an entry's Overview tab that shows one run's
// report — or says why there is none. This file alone writes the frame's
// tag and escapes the framed document into its `srcdoc`.
import { t, type Language } from "../../../i18n";
import { badge } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { BADGE_VARIANT, stateWord, type QueueRowView } from "../../ui/job-state";

/** No `allow-scripts`: nothing in a report runs. `allow-same-origin` lets
 *  the page's own script reach the frame's document (theme, height);
 *  `allow-popups-to-escape-sandbox` makes a clicked link a normal tab. */
export const REPORT_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export interface ReportPanelRun {
  view: QueueRowView;
  startedAt: string;
  /** The framed document (`buildReportDocument`); absent when the run wrote no report. */
  document?: string;
  /** The run's `index.html` on its own; present with `document`. */
  bareHref?: string;
}

export function renderReportPanel(opts: { lang: Language; run?: ReportPanelRun }): string {
  const { lang, run } = opts;
  if (!run) return `<section id="report"><p class="muted">${esc(t(lang, "report.neverRan"))}</p></section>`;
  const label = stateWord(run.view, lang);
  const head =
    `<p class="reporthead">${badge(BADGE_VARIANT[run.view.state], label)} ` +
    `${esc(t(lang, "report.runOf", { time: run.startedAt }))}` +
    (run.document !== undefined && run.bareHref
      ? ` · <a href="${esc(run.bareHref)}">${esc(t(lang, "report.openFile"))}</a>`
      : "") +
    `</p>`;
  const body =
    run.document !== undefined
      ? `<iframe class="reportframe" data-report-frame sandbox="${REPORT_SANDBOX}" ` +
        `title="${esc(t(lang, "report.frameTitle"))}" srcdoc="${esc(run.document)}"></iframe>`
      : `<p class="muted">${esc(t(lang, "report.none", { state: label }))}</p>`;
  return `<section id="report" class="reportpanel"><h2>${esc(t(lang, "report.heading"))}</h2>${head}${body}</section>`;
}
