// The Jobs tab: the board's first page. Every spec the Specs list shows under
// Active, with the list's own row, and the wiki builds and scheduled jobs that
// are in flight or wait for the user, whatever started them. Which jobs live
// in `rows.ts`. A spec's row is drawn by the list's row builder from the same
// options; a wiki or scheduled job's row is `job-row.ts`'s, in the same
// columns. Both sit in `#jobrows`, in one order, so the page script redraws and
// presses them as it does the list's.

import { t } from "../../../i18n";
import { rowMessage } from "../../ui/components/message.ts";
import type { QueueRowView } from "../../ui/job-state";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { renderFailedCreateNotices } from "../specs-list/failed-create-notices.ts";
import { listHead } from "../specs-list/filter-bar.ts";
import { listRefusalLine, refusalRowTemplate } from "../specs-list/notice-row.ts";
import { activeSpecRows, type SpecsPageOptions } from "../specs-list";
import { jobRow } from "./job-row.ts";
import { byTabPlace, jobPlace, specPlace } from "./rows.ts";

export { jobControl, jobHome, jobsShown, jobTitle } from "./rows.ts";
export type { JobLike } from "./rows.ts";

/** What the page draws: the wiki and scheduled jobs it shows, and the Specs
 *  list's options its spec rows are drawn with. */
export interface JobsView {
  /** The wiki builds and scheduled jobs `jobsShown` picks. */
  shown: QueueRowView[];
  /** Every job a spec's row is drawn from (`listedSpecJobs`): the Active rows are built from them. */
  specJobs: QueueRowView[];
  /** The options a spec's row is drawn with, `listPath` set to this page;
   *  `archivedSpecs` holds the archived rows the Active entry shows. */
  list: SpecsPageOptions;
  /** The moment the page is drawn at, for the time of a job still going. */
  now?: number;
}

/** The rows in order, each with its `<project>/<folder>` key: the Active
 *  specs, each once, among the wiki and scheduled jobs, by where each stands. */
function entries(v: JobsView): { key: string; html: string }[] {
  const now = v.now ?? Date.now();
  const lang = v.list.lang ?? "en";
  const specs = activeSpecRows(v.specJobs, v.list, now).map((s) => ({ key: s.key, html: s.html, place: specPlace(s.group) }));
  const jobs = v.shown.map((job) => ({
    key: `${job.project}/${job.specFolder}`,
    html: jobRow(job, { lang, now, filter: v.list.filter ?? {}, listPath: v.list.listPath ?? "/" }),
    place: jobPlace(job),
  }));
  return [...specs, ...jobs].sort((a, b) => byTabPlace(a.place, b.place));
}

/** The failed-create messages and the table, or the sentence for no row. */
export function renderJobsRows(v: JobsView): string {
  const lang = v.list.lang ?? "en";
  const rows = entries(v);
  const notices = renderFailedCreateNotices(v.list.failedCreates ?? [], lang);
  if (!rows.length) return notices || rowMessage("info", t(lang, "jobs.nothingRunning"));
  return (
    notices +
    `<div class="tablewrap"><table class="list speclist">${listHead(lang)}<tbody>` +
    rows.map((r) => r.html).join("") +
    `</tbody></table></div>`
  );
}

/** One spec's rows alone, for a fold: an empty body when the spec has no row
 *  on the page, and the script then redraws the whole list. */
export function renderJobsSpecRows(v: JobsView, key: string): string {
  return `<table><tbody>${entries(v).filter((r) => r.key === key).map((r) => r.html).join("")}</tbody></table>`;
}

export function renderJobsPage(v: JobsView, generatedAt: string, entriesNav: NavEntry[]): string {
  const lang = v.list.lang ?? "en";
  // The refusal line and the row it is copied into sit outside `#jobrows`, so
  // no redraw of the rows replaces either.
  const body = listRefusalLine() + `<div id="jobrows">${renderJobsRows(v)}</div>` + refusalRowTemplate();
  return pageShell("Jobs", entriesNav, "/", body, generatedAt, {
    docTitle: "aide -board · Jobs",
    hideHeading: true,
    script: v.list.script,
    lang,
    currentUrl: v.list.currentUrl,
  });
}
