// Every run of a schedule entry, under its report on the Report tab.
// Each run writes into a directory of its own, so a click anywhere on a
// row opens that run's report on the same page, and the run being shown
// is marked. Sorted through the address, the way the /schedule list is.
import type { Job } from "../../../queue/types.ts";
import { t, type Language } from "../../../i18n";
import { durationLabel } from "../../ui/job-state";
import { esc } from "../../ui/html.ts";
import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { queryHref, resolveSort, sortHeading, type SortColumns, type SortDir } from "./sort-head.ts";
import { schedulePagePath } from "./tabs.ts";

// Newest start first; states A–Z; the longest run first.
const RUN_COLUMNS: SortColumns = {
  keys: ["started", "state", "duration"],
  fallback: "started",
  firstDir: { started: "desc", state: "asc", duration: "desc" },
};

export interface ScheduleRunsOptions {
  lang: Language;
  project: string;
  name: string;
  /** The entry's runs, newest first. */
  runs: readonly Job[];
  /** The id of the run whose report the page shows. */
  shown?: string;
  /** The `?run=` the address named, when it is one of `runs`: a heading
   *  keeps it, so a sort does not change the report shown. */
  keepRun?: string;
  sort?: string;
  dir?: string;
}

const startedAt = (j: Job): string => j.startedAt ?? j.createdAt;
/** A run that has not finished counts as 0, as a missing date does on the /schedule list. */
const durationMs = (j: Job): number => (j.finishedAt ? Date.parse(j.finishedAt) - Date.parse(startedAt(j)) : 0);

export function sortRuns(runs: readonly Job[], f: { sort?: string; dir?: string }): Job[] {
  const { sort, dir } = resolveSort(RUN_COLUMNS, f);
  const sign = dir === "asc" ? 1 : -1;
  const compare = (a: Job, b: Job): number =>
    sort === "state"
      ? a.state.localeCompare(b.state)
      : sort === "duration"
        ? durationMs(a) - durationMs(b)
        : Date.parse(startedAt(a)) - Date.parse(startedAt(b));
  return [...runs].sort((a, b) => compare(a, b) * sign);
}

/** The sort to carry in a run's address: nothing at all for the default,
 *  so a run's link in the default order is `scheduleRunPath` exactly. */
function carriedSort(now: { sort: string; dir: SortDir }): { sort?: string; dir?: string } {
  const firstDir = now.dir === RUN_COLUMNS.firstDir[now.sort];
  if (now.sort === RUN_COLUMNS.fallback && firstDir) return {};
  return { sort: now.sort, dir: firstDir ? undefined : now.dir };
}

function row(job: Job, href: string, shown: boolean): string {
  const duration = job.finishedAt ? durationLabel(durationMs(job)) : `<span class="muted">–</span>`;
  return (
    // The whole row opens the run (`followScheduleRow`); the stamp is a
    // real link, so a modifier-click opens it in a new tab.
    `<tr data-row-href="${esc(href)}"${shown ? ` aria-current="true"` : ""}>` +
    `<td><a href="${esc(href)}">${esc(startedAt(job))}</a></td>` +
    `<td>${esc(capitalizeFirst(job.state))}</td><td>${duration}</td></tr>`
  );
}

/** Nothing for an entry that has never run: the report above says so. */
export function renderScheduleRuns(o: ScheduleRunsOptions): string {
  if (o.runs.length === 0) return "";
  const page = schedulePagePath(o.project, o.name);
  const now = resolveSort(RUN_COLUMNS, o);
  const keep = carriedSort(now);
  const runHref = (id: string): string => `${queryHref(page, { run: id, ...keep })}#report`;
  const headHref = (sort: string, dir: string): string => `${queryHref(page, { run: o.keepRun, sort, dir })}#runs`;
  const th = (key: string, label: string): string => sortHeading(RUN_COLUMNS, now, key, label, headHref);
  return (
    `<section id="runs" class="reportpanel"><h2>${esc(t(o.lang, "report.runsHeading"))}</h2>` +
    `<div class="tablewrap"><table class="list"><thead><tr>` +
    th("started", t(o.lang, "job.started")) +
    th("state", t(o.lang, "report.runsState")) +
    th("duration", t(o.lang, "report.runsDuration")) +
    `</tr></thead><tbody>` +
    sortRuns(o.runs, now).map((j) => row(j, runHref(j.id), j.id === o.shown)).join("") +
    `</tbody></table></div></section>`
  );
}
