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
import { activeSpecRows, specRowsOf, type ArchivedSpecView, type SpecTarget, type SpecsPageOptions } from "../specs-list";
import { groupBySpec, groupKey, isFinishedGroup, type SpecGroup } from "../specs-list/data-model";
import { currentWorkRoundJobs } from "../../../queue/steps.ts";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";
import { jobsFilterBar, jobsHead } from "./filter-bar.ts";
import { jobRow } from "./job-row.ts";
import { byTabPlace, jobPlace, jobRowKeys, specPlace, specRounds, specsStoodForByJobs, type TabPlace } from "./rows.ts";
import { jobFacts, jobsStateOpensGroups, jobsViewRows, type RowFacts } from "./view.ts";
import { executionGroupActivity, type ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupCard, executionGroupPlace } from "./execution-group-card.ts";
import { groupBranch } from "../../../project/spec-names.ts";
import { eligibleGroupMembers, groupAddCandidates } from "../../../queue/execution-groups/eligibility.ts";
import { executionGroupEditor } from "./execution-group-editor.ts";

export { jobControl, jobKey, jobsShown, jobTitle, scheduleStreamKey } from "./rows.ts";
export type { JobLike } from "./rows.ts";
export { rowInputs } from "./one-row.ts";

/** Whether the row with a key is drawn. Absent, every row is. */
type Draws = (key: string) => boolean;

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
  /** Set where the view is cut to one row (`rowInputs`): the specs it was cut
   *  to, the only ones a group is built for. */
  specs?: ReadonlySet<string>;
  /** Set with `specs`: each job row's key by job id, in place of the keys
   *  `shown` alone would give. */
  rowKeys?: Map<string, string>;
}

/** The options the tab draws a spec's row with: the list's, and the row's kind shown. */
const listOf = (v: JobsView): SpecsPageOptions => ({ ...v.list, kindIcon: true });

/** The rows in order, each with its `<project>/<folder>` key and the facts the
 *  view's filter and sort read: the Active specs, each once, among the
 *  scheduled jobs, by where each stands. A row that `draws` answers no for
 *  keeps its key, place and facts, with an empty `html`. */
function entries(v: JobsView, draws: Draws = () => true): { key: string; html: string; place: TabPlace; facts: RowFacts }[] {
  const now = v.now ?? Date.now();
  const lang = v.list.lang ?? "en";
  const moving = specsStoodForByJobs(v.shown);
  const specRows = roundSpecRows(v, now, draws);
  const activeGroups = activeExecutionGroups(v, specRows);
  const grouped = new Set(activeGroups.flatMap((group) => group.members.map((folder) => `${group.project}/${folder}`)));
  const specs = specRows.filter((s) => !moving.has(s.key) && !grouped.has(s.key)).map((s) => ({
    key: s.key, html: s.html, place: specPlace(s.group, s.jobs),
    facts: s.key.includes("@") ? { ...s.group, pastRound: true } : s.group,
  }));
  const openFor = jobsStateOpensGroups(v.list.filter?.state);
  const groups = activeGroups.map((group) => {
    const members = specRows.filter((row) => group.project === row.group.project && group.members.includes(row.group.specFolder));
    const failed = members.find((row) => ["failed", "interrupted", "cancelled", "archived-unlanded"].includes(row.group.state));
    const key = `execution-group:${group.id}`;
    // Each member's current row, by its key: an earlier round of a reopened
    // member is a row of its own, and is counted there.
    const current: RowFacts[] = group.members
      .map((folder) => specRows.find((row) => row.key === groupKey(group.project, folder))?.group)
      .filter((member): member is SpecGroup => !!member);
    return {
      key,
      html: draws(key)
        ? executionGroupCard(group, specRows, lang, {
          openFor,
          addCandidates: groupAddCandidates({ project: group.project, members: group.members, targets: v.list.targets, groups: activeGroups, jobs: groupJobs(v) }),
        })
        : "",
      place: executionGroupPlace(group, members),
      facts: {
        project: group.project, specFolder: group.name,
        state: executionGroupRowState(group, !!failed),
        title: group.name, createdAt: group.createdAt, itemCount: group.members.length,
        members: current,
      } as RowFacts,
    };
  });
  const rowKeys = v.rowKeys ?? jobRowKeys(v.shown);
  const jobs = v.shown.map((job) => {
    const key = rowKeys.get(job.id)!;
    return {
      key,
      html: draws(key)
        ? jobRow(job, { lang, now, filter: v.list.filter ?? {}, listPath: v.list.listPath ?? "/", steps: v.list.closeOrReopenSteps, pips: v.list.jobStepPips, commits: v.list.deployCommits, key })
        : "",
      place: jobPlace(job, v.shown, v.scheduleEntryExists),
      facts: jobFacts(job, now),
    };
  });
  return [...specs, ...groups, ...jobs].sort((a, b) => byTabPlace(a.place, b.place));
}

interface SpecRow { key: string; group: SpecGroup; html: string; jobs: QueueRowView[] }

/** Every spec's row: the current round of each active spec, as the Specs
 *  list's Active entry draws it; each archived or closed spec, as the list
 *  draws its archived rows; and each earlier round of a spec, under a key
 *  of its own, which is the key `draws` is asked for it. */
function roundSpecRows(v: JobsView, now: number, draws: Draws = () => true): SpecRow[] {
  const bySpec = new Map<string, QueueRowView[]>();
  for (const job of v.specJobs) {
    const key = groupKey(job.project, job.specFolder);
    bySpec.set(key, [...(bySpec.get(key) ?? []), job]);
  }
  const roundOf = (key: string): QueueRowView[] => currentWorkRoundJobs(bySpec.get(key) ?? []);
  const rows: SpecRow[] = activeSpecRows(v.specJobs, listOf(v), now, v.specs, draws).map((row) => ({ ...row, jobs: roundOf(row.key) }));
  const drawn = new Set(rows.map((row) => row.key));
  const history = (v.historySpecs ?? []).filter((spec) => !drawn.has(groupKey(spec.project, spec.folder)));
  const historyKeys = history.map((spec) => groupKey(spec.project, spec.folder));
  const historyGroups = groupBySpec(historyKeys.flatMap((key) => bySpec.get(key) ?? []), [], historyKeys, history, now);
  rows.push(...specRowsOf(historyGroups, listOf(v), now, draws).map((row) => ({ ...row, jobs: roundOf(row.key) })));

  const targets = new Map<string, SpecTarget>(v.list.targets.map((target) => [groupKey(target.project, target.specFolder), target]));
  for (const spec of history) {
    targets.set(groupKey(spec.project, spec.folder), {
      project: spec.project, specFolder: spec.folder, title: spec.title, description: spec.description,
      createdAt: spec.createdAt, done: spec.done, notVerified: spec.notVerified,
    });
  }
  for (const [baseKey, jobs] of bySpec) {
    const target = targets.get(baseKey);
    if (!target) continue;
    // The last round is the spec's own row above; each one before it is a row of its own.
    for (const round of specRounds(jobs, target.createdAt).slice(0, -1)) {
      const key = `${baseKey}@${encodeURIComponent(round.startedAt)}`;
      const open = (v.list.filter?.open ?? "").split(",").includes(key) ? baseKey : "";
      const roundTarget = { ...target, createdAt: round.startedAt };
      const built = specRowsOf(groupBySpec(round.jobs, [roundTarget], undefined, undefined, now), {
        ...listOf(v), targets: [roundTarget], archivedSpecs: [], filter: { ...v.list.filter, open },
      }, now, () => draws(key))[0];
      if (!built) continue;
      rows.push({
        key,
        jobs: round.jobs,
        group: { ...built.group, createdAt: round.startedAt },
        html: built.html
          .replaceAll(`id="spec-${baseKey}"`, `id="spec-${key}"`)
          .replaceAll(`data-key="${baseKey}"`, `data-key="${key}"`)
          .replaceAll(`open=${encodeURIComponent(baseKey)}`, `open=${encodeURIComponent(key)}`),
      });
    }
  }
  return rows;
}

function activeExecutionGroups(v: JobsView, specRows: { key: string; group: SpecGroup; html: string }[] = roundSpecRows(v, v.now ?? Date.now())): ExecutionGroup[] {
  const registered = v.executionGroups ?? [];
  const known = new Set(registered.map((group) => `${group.project}\n${group.name}`));
  const legacy = new Map<string, typeof specRows>();
  // Only specs still to run make a card from their `Group:` lines: archived
  // and closed members are history, and a group of them has nothing to start.
  for (const row of specRows) {
    if (!row.group.group || isFinishedGroup(row.group)) continue;
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
  // A removed group draws no card; its name in `known` above still keeps its
  // members' `Group:` lines from drawing one.
  return [...registered.filter((group) => !group.removedAt), ...prepared];
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
    jobsFilterBar(all.map((e) => e.facts), f, lang) +
    `<div class="tablewrap"><table class="list speclist" data-list="jobs">${jobsHead(f, lang)}<tbody>${body}</tbody></table></div>`
  );
}

/** The jobs a spec offered for a group is checked against: one in flight is not offered. */
const groupJobs = (v: JobsView): { project: string; specFolder: string; state: string }[] =>
  [...v.shown, ...v.specJobs].map((job) => ({ project: job.project, specFolder: job.specFolder, state: job.state }));

function executionGroupEditors(v: JobsView, lang: Language): string {
  const groups = activeExecutionGroups(v);
  const projects = [...new Set(v.list.targets.map((target) => target.project))].sort();
  const jobs = groupJobs(v);
  const candidates = projects.flatMap((project) => eligibleGroupMembers({ project, targets: v.list.targets, groups, jobs }));
  return executionGroupEditor({ projects, candidates, lang });
}

/** One spec's rows alone, for a fold: an empty body when the spec has no row
 *  on the page or the view hides it, and the script then redraws the whole list. */
export function renderJobsSpecRows(v: JobsView, key: string): string {
  // The asked row alone is drawn. A card holds its members' rows, so a card's key draws every row.
  const draws: Draws = key.startsWith("execution-group:") ? () => true : (k) => k === key;
  const shown = jobsViewRows(entries(v, draws), v.list.filter ?? {});
  const own = shown.filter((r) => r.key === key).map((r) => r.html);
  return `<table><tbody>${own.length ? own.join("") : groupMemberRows(v, key, new Set(shown.map((r) => r.key)), draws)}</tbody></table>`;
}

/** A spec drawn inside a group's card on the page: its own rows, as the card
 *  draws them, while the card itself is shown. */
function groupMemberRows(v: JobsView, key: string, shown: Set<string>, draws: Draws): string {
  const specRows = activeSpecRows(v.specJobs, listOf(v), v.now ?? Date.now(), v.specs, draws);
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
