// The Jobs tab: the board's first page. Every spec the Specs list shows under
// Active, with the list's own row, and the scheduled jobs that
// are in flight or wait for the user, whatever started them. Which jobs live
// in `rows.ts`. A spec's row is drawn by the list's row builder from the same
// options; a scheduled job's row is `job-row.ts`'s, in the same
// columns. Both sit in `#jobrows`, in one order, so the page script redraws and
// presses them as it does the list's.

import { t } from "../../../i18n";
import type { Language } from "../../../i18n";
import type { QueueRowView } from "../../ui/job-state";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { renderFailedCreateNotices } from "../specs-list/failed-create-notices.ts";
import { listRefusalLine, refusalRowTemplate } from "../specs-list/notice-row.ts";
import { activeSpecRows, type ArchivedSpecView, type SpecTarget, type SpecsPageOptions } from "../specs-list";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { jobsFilterBar, jobsHead } from "./filter-bar.ts";
import { jobRow } from "./job-row.ts";
import { byTabPlace, jobKey, jobPlace, specPlace, specRounds, specsStoodForByJobs, type TabPlace } from "./rows.ts";
import { jobFacts, jobsViewRows, type RowFacts } from "./view.ts";
import { executionGroupActivity, type ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupCard, executionGroupPlace } from "./execution-group-card.ts";
import { groupBranch } from "../../../project/spec-names.ts";
import { eligibleGroupMembers } from "../../../queue/execution-groups/eligibility.ts";
import { executionGroupEditor } from "./execution-group-editor.ts";

export { jobControl, jobKey, jobsShown, jobTitle, scheduleStreamKey } from "./rows.ts";
export type { JobLike } from "./rows.ts";

export function executionGroupRowState(group: ExecutionGroup, failed: boolean): RowFacts["state"] {
  if (group.state === "completed") return "done";
  const activity = executionGroupActivity(group.state);
  return failed ? "failed" : activity === "idle" ? "stopped" : activity;
}

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
  /** Archived and closed specs whose rounds remain in job history. */
  historySpecs?: ArchivedSpecView[];
  scheduleEntryExists?: (project: string, name: string) => boolean;
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
  const specRows = roundSpecRows(v, now);
  const activeGroups = activeExecutionGroups(v, specRows);
  const grouped = new Set(activeGroups.flatMap((group) => group.members.map((folder) => `${group.project}/${folder}`)));
  const specs = specRows.filter((s) => !moving.has(s.key) && !grouped.has(s.key)).map((s) => ({
    key: s.key, html: s.html, place: specPlace(s.group), facts: s.group,
  }));
  const groups = activeGroups.map((group) => {
    const members = specRows.filter((row) => group.project === row.group.project && group.members.includes(row.group.specFolder));
    const failed = members.find((row) => ["failed", "interrupted", "cancelled", "archived-unlanded"].includes(row.group.state));
    return {
      key: `execution-group:${group.id}`,
      html: executionGroupCard(group, specRows, lang),
      place: executionGroupPlace(group, members),
      facts: {
        project: group.project, specFolder: group.name,
        state: executionGroupRowState(group, !!failed),
        failed: members.reduce((sum, row) => sum + (row.group.failed ?? 0), 0),
        title: group.name, createdAt: group.createdAt, itemCount: group.members.length,
      } as RowFacts,
    };
  });
  const jobs = v.shown.map((job) => ({
    key: jobKey(job),
    html: jobRow(job, { lang, now, filter: v.list.filter ?? {}, listPath: v.list.listPath ?? "/", steps: v.list.closeOrReopenSteps }),
    place: jobPlace(job, v.shown, v.scheduleEntryExists),
    facts: jobFacts(job, now),
  }));
  return [...specs, ...groups, ...jobs].sort((a, b) => byTabPlace(a.place, b.place));
}

function roundSpecRows(v: JobsView, now: number) {
  const bySpec = new Map<string, QueueRowView[]>();
  for (const job of v.specJobs) {
    const key = `${job.project}/${job.specFolder}`;
    bySpec.set(key, [...(bySpec.get(key) ?? []), job]);
  }
  const rows = activeSpecRows(v.specJobs, v.list, now);
  const targets = new Map<string, SpecTarget>();
  for (const target of v.list.targets) targets.set(`${target.project}/${target.specFolder}`, target);
  for (const archived of v.historySpecs ?? []) {
    const key = `${archived.project}/${archived.folder}`;
    if (!targets.has(key)) targets.set(key, {
      project: archived.project,
      specFolder: archived.folder,
      title: archived.title,
      description: archived.description,
      createdAt: archived.createdAt,
      done: archived.done,
      notVerified: archived.notVerified,
    });
  }
  for (const target of targets.values()) {
    const baseKey = `${target.project}/${target.specFolder}`;
    const history = bySpec.get(baseKey) ?? [];
    const rounds = specRounds(history, target.createdAt);
    const existing = rows.findIndex((row) => row.key === baseKey);
    if (rounds.length <= 1 && existing >= 0) continue;
    if (rounds.length > 1 && existing >= 0) rows.splice(existing, 1);
    if (!rounds.length) {
      const archived = (v.historySpecs ?? []).find((spec) => spec.project === target.project && spec.folder === target.specFolder);
      rows.push(...activeSpecRows([], { ...v.list, targets: [target], archivedSpecs: [] }, now).map((row) => ({
        ...row,
        group: archived ? { ...row.group, state: archived.closed ? "closed" as const : "archived" as const } : row.group,
      })));
      continue;
    }
    for (const round of rounds) {
      const open = (v.list.filter?.open ?? "").split(",").includes(round.key) ? baseKey : "";
      const built = activeSpecRows(round.jobs, {
        ...v.list,
        targets: [{ ...target, createdAt: round.startedAt }],
        archivedSpecs: [],
        filter: { ...v.list.filter, open },
      }, now)[0];
      if (!built) continue;
      const encodedBase = encodeURIComponent(baseKey);
      const encodedRound = encodeURIComponent(round.key);
      rows.push({
        ...built,
        key: round.key,
        group: { ...built.group, createdAt: round.startedAt },
        html: built.html
          .replaceAll(`id="spec-${baseKey}"`, `id="spec-${round.key}"`)
          .replaceAll(`data-key="${baseKey}"`, `data-key="${round.key}"`)
          .replaceAll(`open=${encodedBase}`, `open=${encodedRound}`),
      });
    }
  }
  return rows;
}

function activeExecutionGroups(v: JobsView, specRows = roundSpecRows(v, v.now ?? Date.now())): ExecutionGroup[] {
  const registered = v.executionGroups ?? [];
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
  return [...registered, ...prepared];
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
    notices + executionGroupEditors(v, lang) +
    jobsFilterBar(all.map((e) => e.facts), f, lang, v.list) +
    `<div class="tablewrap"><table class="list speclist" data-list="jobs">${jobsHead(f, lang)}<tbody>${body}</tbody></table></div>`
  );
}

function executionGroupEditors(v: JobsView, lang: Language): string {
  const groups = activeExecutionGroups(v);
  const projects = [...new Set(v.list.targets.map((target) => target.project))].sort();
  const jobs = [...v.shown, ...v.specJobs].map((job) => ({ project: job.project, specFolder: job.specFolder, state: job.state }));
  const candidates = projects.flatMap((project) => eligibleGroupMembers({ project, targets: v.list.targets, groups, jobs }));
  return executionGroupEditor({ projects, candidates, lang });
}

/** One spec's rows alone, for a fold: an empty body when the spec has no row
 *  on the page or the view hides it, and the script then redraws the whole list. */
export function renderJobsSpecRows(v: JobsView, key: string): string {
  const shown = jobsViewRows(entries(v), v.list.filter ?? {});
  const own = shown.filter((r) => r.key === key).map((r) => r.html);
  return `<table><tbody>${own.length ? own.join("") : groupMemberRows(v, key, new Set(shown.map((r) => r.key)))}</tbody></table>`;
}

/** A spec drawn inside a group's card on the page: its own rows, as the card
 *  draws them, while the card itself is shown. */
function groupMemberRows(v: JobsView, key: string, shown: Set<string>): string {
  const specRows = activeSpecRows(v.specJobs, v.list, v.now ?? Date.now());
  const row = specRows.find((s) => s.key === key);
  const inShownGroup = row && activeExecutionGroups(v, specRows).some((group) =>
    shown.has(`execution-group:${group.id}`) && group.project === row.group.project && group.members.includes(row.group.specFolder));
  return inShownGroup ? row.html : "";
}

export function renderJobsPage(v: JobsView, generatedAt: string, entriesNav: NavEntry[]): string {
  const lang = v.list.lang ?? "en";
  // The refusal line and the row it is copied into sit outside `#jobrows`, so
  // no redraw of the rows replaces either.
  const body = listRefusalLine() + `<div id="jobrows">${renderJobsRows(v)}</div>` + refusalRowTemplate();
  return pageShell("Jobs", entriesNav, "/", body, generatedAt, {
    hideHeading: true,
    script: v.list.script,
    lang,
    currentUrl: v.list.currentUrl,
    // A browser tab that starts here with nothing running goes where `/app`
    // sends it: the Specs list, bare, with the filter and sort its cookies keep.
    startAt: jobsTabHasRows(v) ? undefined : "/specs",
  });
}
