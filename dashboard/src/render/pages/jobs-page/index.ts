// The Jobs tab: the board's first page. Every job that is queued, running or
// landing, and every finished one that waits for the user, whatever started
// it. Which jobs live in `rows.ts`. A spec's row is the Specs list's own,
// drawn by its row builder from the same options; a wiki or scheduled job's
// row is `job-row.ts`'s, in the same columns. Both sit in `#jobrows`, so the
// page script redraws and presses them as it does the list's.

import { t } from "../../../i18n";
import { rowMessage } from "../../ui/components/message.ts";
import type { QueueRowView } from "../../ui/job-state";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { renderFailedCreateNotices } from "../specs-list/failed-create-notices.ts";
import { listHead } from "../specs-list/filter-bar.ts";
import { listRefusalLine, refusalRowTemplate } from "../specs-list/notice-row.ts";
import { specGroupRowsByKey, type SpecsPageOptions } from "../specs-list";
import { jobRow } from "./job-row.ts";

export { jobControl, jobHome, jobsShown, jobTitle } from "./rows.ts";
export type { JobLike } from "./rows.ts";

/** What the page draws: the jobs it shows, and the Specs list's options its
 *  spec rows are drawn with. */
export interface JobsView {
  /** The shown jobs, in the order they are shown. */
  shown: QueueRowView[];
  /** Every job of the specs that may have the list's row, not only the shown
   *  ones: a row's phases, times and cost come from its spec's whole history. */
  specJobs: QueueRowView[];
  /** `<project>/<folder>` of the shown jobs that are a spec's step, in a
   *  project on the allowlist. Any other shown job gets a job row. */
  specKeys: ReadonlySet<string>;
  /** A spec's own title, by project and folder. */
  titleOf: (project: string, specFolder: string) => string | undefined;
  /** The options a spec's row is drawn with, `listPath` set to this page. */
  list: SpecsPageOptions;
  /** The moment the page is drawn at, for the time of a job still going. */
  now?: number;
}

const keyOf = (r: { project: string; specFolder: string }): string => `${r.project}/${r.specFolder}`;

/** The rows in order, each with its `<project>/<folder>` key. A spec stands
 *  where its first shown job stands, once; a shown job the list's builder
 *  draws no group for (a project off the allowlist, a spec whose folder is
 *  gone) has a job row. */
function entries(v: JobsView): { key: string; html: string }[] {
  const now = v.now ?? Date.now();
  const specRows = specGroupRowsByKey(v.specJobs, v.list, v.specKeys, now);
  const lang = v.list.lang ?? "en";
  const seen = new Set<string>();
  const out: { key: string; html: string }[] = [];
  for (const job of v.shown) {
    const key = keyOf(job);
    const spec = v.specKeys.has(key) ? specRows.get(key) : undefined;
    if (spec === undefined) {
      out.push({ key, html: jobRow(job, { titleOf: v.titleOf, lang, now }) });
    } else if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, html: spec });
    }
  }
  return out;
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
