// The Jobs tab: the board's first page. Every spec the Specs list shows under
// Active, with the list's own row, and the scheduled jobs that
// are in flight or wait for the user, whatever started them. Which jobs live
// in `rows.ts`. A spec's row is drawn by the list's row builder from the same
// options; a scheduled job's row is `job-row.ts`'s, in the same
// columns. Both sit in `#jobrows`, in one order, so the page script redraws and
// presses them as it does the list's.

import { t } from "../../../i18n";
import type { QueueRowView } from "../../ui/job-state";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { renderFailedCreateNotices } from "../specs-list/failed-create-notices.ts";
import { listRefusalLine, refusalRowTemplate } from "../specs-list/notice-row.ts";
import { activeSpecRows, type SpecsPageOptions } from "../specs-list";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { jobsFilterBar, jobsHead } from "./filter-bar.ts";
import { jobRow } from "./job-row.ts";
import { byTabPlace, jobKey, jobPlace, specPlace, specsStoodForByJobs, type TabPlace } from "./rows.ts";
import { jobFacts, jobsViewRows, type RowFacts } from "./view.ts";
import { executionGroupActivity, type ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupCard, executionGroupPlace } from "./execution-group-card.ts";
import { groupBranch } from "../../../project/spec-names.ts";

export { jobControl, jobKey, jobsShown, jobTitle, scheduleStreamKey } from "./rows.ts";
export type { JobLike } from "./rows.ts";

/** What the page draws: the scheduled jobs it shows, and the Specs
 *  list's options its spec rows are drawn with. */
export interface JobsView {
  /** The scheduled jobs `jobsShown` picks. */
  shown: QueueRowView[];
  /** Every job a spec's row is drawn from (`listedSpecJobs`): the Active rows are built from them. */
  specJobs: QueueRowView[];
  /** The options a spec's row is drawn with, `listPath` set to this page;
   *  `archivedSpecs` holds the archived rows the Active entry shows. */
  list: SpecsPageOptions;
  executionGroups?: ExecutionGroup[];
  /** The moment the page is drawn at, for the time of a job still going. */
  now?: number;
}

/** The rows in order, each with its `<project>/<folder>` key and the facts the
 *  view's filter and sort read: the Active specs, each once, among the
 *  scheduled jobs, by where each stands. */
function entries(v: JobsView): { key: string; html: string; place: TabPlace; facts: RowFacts }[] {
  const now = v.now ?? Date.now();
  const lang = v.list.lang ?? "en";
  const moving = specsStoodForByJobs(v.shown);
  const specRows = activeSpecRows(v.specJobs, v.list, now);
  const registered = (v.executionGroups ?? []).filter((group) => group.state !== "completed");
  const known = new Set(registered.map((group) => `${group.project}\n${group.name}`));
  const legacy = new Map<string, typeof specRows>();
  for (const row of specRows) {
    if (!row.group.group) continue;
    const key = `${row.group.project}\n${row.group.group.name}`;
    if (!known.has(key)) legacy.set(key, [...(legacy.get(key) ?? []), row]);
  }
  const prepared = [...legacy.entries()].flatMap(([key, rows]) => {
    if (rows.length < 2) return [];
    const ordered = [...rows].sort((a, b) => a.group.group!.position - b.group.group!.position || a.group.specFolder.localeCompare(b.group.specFolder));
    const [project, name] = key.split("\n") as [string, string];
    return [{
      id: `membership:${project}:${name}`, project, name,
      members: ordered.map((row) => row.group.specFolder),
      branch: groupBranch(ordered[0]!.group.specFolder, name),
      state: "prepared" as const,
      createdAt: ordered.map((row) => row.group.createdAt).filter((date): date is string => !!date).sort()[0],
      completedMembers: ordered.filter((row) => row.group.done.includes("implement")).map((row) => row.group.specFolder),
      jobs: [],
    }];
  });
  const activeGroups = [...registered, ...prepared];
  const grouped = new Set(activeGroups.flatMap((group) => group.members.map((folder) => `${group.project}/${folder}`)));
  const specs = specRows.filter((s) => !moving.has(s.key) && !grouped.has(s.key)).map((s) => ({
    key: s.key, html: s.html, place: specPlace(s.group), facts: s.group,
  }));
  const groups = activeGroups.map((group) => {
    const members = specRows.filter((row) => group.project === row.group.project && group.members.includes(row.group.specFolder));
    const failed = members.find((row) => ["failed", "interrupted", "cancelled", "archived-unlanded"].includes(row.group.state));
    const activity = executionGroupActivity(group.state);
    return {
      key: `execution-group:${group.id}`,
      html: executionGroupCard(group, specRows, lang),
      place: executionGroupPlace(group, members),
      facts: {
        project: group.project, specFolder: group.name,
        state: failed ? "failed" : activity === "idle" ? "stopped" : activity,
        failed: members.reduce((sum, row) => sum + (row.group.failed ?? 0), 0),
        title: group.name, createdAt: group.createdAt,
      } as RowFacts,
    };
  });
  const jobs = v.shown.map((job) => ({
    key: jobKey(job),
    html: jobRow(job, { lang, now, filter: v.list.filter ?? {}, listPath: v.list.listPath ?? "/", steps: v.list.closeOrReopenSteps }),
    place: jobPlace(job),
    facts: jobFacts(job, now),
  }));
  return [...specs, ...groups, ...jobs].sort((a, b) => byTabPlace(a.place, b.place));
}

/** Whether the tab has a row to draw once its view has cut them: what the
 *  installed app's start address chooses between this tab and the Specs
 *  list by, and what decides whether this tab names the Specs list as the
 *  page a browser tab starts on. A failed create's message is not a row. */
export function jobsTabHasRows(v: JobsView): boolean {
  return jobsViewRows(entries(v), v.list.filter ?? {}).length > 0;
}

/** The failed-create messages, the bar and the table, with an empty row
 *  when there is nothing to show. */
export function renderJobsRows(v: JobsView): string {
  const lang = v.list.lang ?? "en";
  const all = entries(v);
  const notices = renderFailedCreateNotices(v.list.failedCreates ?? [], lang);
  const f = v.list.filter ?? {};
  const shown = jobsViewRows(all, f);
  const body = shown.length
    ? shown.map((r) => r.html).join("")
    : `<tr><td colspan="${LIST_COLUMNS}" class="empty muted">${t(lang, all.length ? "jobs.noRowMatchesFilter" : "jobs.nothingRunning")}</td></tr>`;
  return (
    notices +
    jobsFilterBar(all.map((e) => e.facts), f, lang, v.list) +
    `<div class="tablewrap"><table class="list speclist" data-list="jobs">${jobsHead(f, lang)}<tbody>${body}</tbody></table></div>`
  );
}

/** One spec's rows alone, for a fold: an empty body when the spec has no row
 *  on the page or the view hides it, and the script then redraws the whole list. */
export function renderJobsSpecRows(v: JobsView, key: string): string {
  const shown = jobsViewRows(entries(v), v.list.filter ?? {});
  return `<table><tbody>${shown.filter((r) => r.key === key).map((r) => r.html).join("")}</tbody></table>`;
}

export function renderJobsPage(v: JobsView, generatedAt: string, entriesNav: NavEntry[]): string {
  const lang = v.list.lang ?? "en";
  // The refusal line and the row it is copied into sit outside `#jobrows`, so
  // no redraw of the rows replaces either.
  const body = listRefusalLine() + `<div id="jobrows">${renderJobsRows(v)}</div>` + refusalRowTemplate();
  return pageShell("Running", entriesNav, "/", body, generatedAt, {
    hideHeading: true,
    script: v.list.script,
    lang,
    currentUrl: v.list.currentUrl,
    // A browser tab that starts here with nothing running goes where `/app`
    // sends it: the Specs list, bare, with the filter and sort its cookies keep.
    startAt: jobsTabHasRows(v) ? undefined : "/specs",
  });
}
