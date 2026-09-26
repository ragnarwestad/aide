// Spec 495: the panel on an entry's Overview tab that shows one run's
// report — or says why there is none. This file alone writes the frame's
// tag and escapes the framed document into its `srcdoc`.
import { t, type Language } from "../../../i18n";
import { badge, rowMessage } from "../../ui/components";
import { esc, relTime } from "../../ui/html.ts";
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

/** A newer run of the entry that has not finished: the panel still shows
 *  the last finished run's report, and says this above it. */
export type PendingRun = "queued" | "running";

export function renderReportPanel(opts: { lang: Language; run?: ReportPanelRun; pending?: PendingRun; now?: number }): string {
  const { lang, run, pending } = opts;
  if (!run) {
    const words = pending ? t(lang, pending === "queued" ? "report.notYetQueued" : "report.notYetRunning") : t(lang, "report.neverRan");
    return `<section id="report"><p class="muted">${esc(words)}</p></section>`;
  }
  const label = stateWord(run.view, lang);
  const note = pending
    ? rowMessage("info", t(lang, pending === "queued" ? "report.pendingQueued" : "report.pendingRunning"), { tag: "p" })
    : "";
  // The time as the board says it everywhere else ("5 d ago"), with the
  // exact stamp in its tooltip; placed into the sentence after escaping.
  const MARK = "\u0000";
  const ran = esc(t(lang, "report.ranAt", { time: MARK })).replace(MARK, relTime(run.startedAt, opts.now ?? Date.now()));
  const head =
    `<p class="reporthead">${badge(BADGE_VARIANT[run.view.state], label)} ${ran}` +
    (run.document !== undefined && run.bareHref
      ? ` · <a href="${esc(run.bareHref)}">${esc(t(lang, "report.openFile"))}</a>`
      : "") +
    `</p>`;
  const body =
    run.document !== undefined
      ? `<iframe class="reportframe" data-report-frame sandbox="${REPORT_SANDBOX}" ` +
        `title="${esc(t(lang, "report.frameTitle"))}" srcdoc="${esc(run.document)}"></iframe>`
      : `<p class="muted">${esc(t(lang, "report.none", { state: label }))}</p>`;
  // No heading: the tab above already says Report.
  return `<section id="report" class="reportpanel">${note}${head}${body}</section>`;
}
