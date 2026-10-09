// The Jobs tab's view rules, as pure functions: which state entries it offers,
// what a wiki or scheduled job's row is to the filter and the sort, which rows
// a view leaves and in what order, what each dropdown offers and counts, and
// where a view link goes. The filter and the sort are the Specs list's own,
// run over the facts a row has; the bar and the page draw what this decides.

import type { Language } from "../../../i18n";
import { inFlight, type QueueRowView } from "../../ui/job-state";
import {
  DEFAULT_STATE_FILTER,
  NOT_VERIFIED_KEY,
  SORTS,
  SORT_DEFAULT_DIR,
  STATE_FILTERS,
  applyFilter,
  matchesSearch,
  matchesStateFilter,
  sortGroups,
  stateFilter,
  type SpecGroup,
  type SpecsFilter,
} from "../specs-list/data-model";
import { queuePath } from "../specs-list/filter-bar.ts";
import { byTabPlace, jobTitle, type TabPlace } from "./rows.ts";

/** The state entries the Jobs tab offers, in the list's order: All, Running,
 *  Waiting, Stopped, Failed, Not verified. Active, Archived and Closed say
 *  nothing about a tab that shows only Active specs. */
const JOBS_STATE_KEYS = ["all", "active:all", "waiting", "stopped", "failed", NOT_VERIFIED_KEY];
export const JOBS_STATE_FILTERS = STATE_FILTERS.filter((s) => JOBS_STATE_KEYS.includes(s.key));

/** The entry a key names on this tab: one it does not offer is All. */
export function jobsStateFilter(key: string | undefined): (typeof JOBS_STATE_FILTERS)[number] {
  const entry = stateFilter(key);
  return JOBS_STATE_FILTERS.includes(entry) ? entry : DEFAULT_STATE_FILTER;
}

/** What the filter and the sort read off a row. */
export type RowFacts = Pick<
  SpecGroup,
  | "project" | "specFolder" | "title" | "description" | "state" | "notVerified" | "failed"
  | "spentUsd" | "createdAt" | "totalDurationMs" | "lead"
>;

/** When a job that is not going ended, in milliseconds; NaN when the queue
 *  recorded no end. */
export const jobEndMs = (row: Pick<QueueRowView, "finishedAt" | "results">): number =>
  Date.parse(row.finishedAt ?? row.results?.at(-1)?.at ?? "");

/** The figure a job row's Time cell shows: from its start while it goes, its
 *  span once ended, 0 before it starts or with no end. The column sorts by it. */
export function jobDurationMs(row: QueueRowView, now: number): number {
  if (!row.startedAt) return 0;
  const start = Date.parse(row.startedAt);
  if (inFlight(row)) return Math.max(0, now - start);
  const end = jobEndMs(row);
  return Number.isNaN(end) ? 0 : Math.max(0, end - start);
}

/** A wiki or scheduled job's facts: its title as the row shows it, its state
 *  with a landing read as running (as a spec's group reads it), its cost, the
 *  moment it was made and its time. No criteria, so never Not verified. */
export function jobFacts(row: QueueRowView, lang: Language, now: number): RowFacts {
  return {
    project: row.project,
    specFolder: row.specFolder,
    title: jobTitle(row, lang),
    state: row.landing ? "running" : row.state,
    spentUsd: row.spentUsd,
    createdAt: row.createdAt,
    totalDurationMs: jobDurationMs(row, now),
    lead: row,
  };
}

/** The view with its state entry resolved for this tab: an entry the tab does
 *  not offer (an old `archived` or `closed` link) is All, before anything is
 *  filtered or counted. */
const onTab = (f: SpecsFilter): SpecsFilter => ({ ...f, state: jobsStateFilter(f.state).key });

/** The rows the view shows, in its order: the state entry, the project and the
 *  search cut them as `applyFilter` does; a column the view names orders them
 *  as `sortGroups` does; with none, the tab's own order (`byTabPlace`). */
export function jobsViewRows<E extends { facts: RowFacts; place: TabPlace }>(entries: E[], f: SpecsFilter): E[] {
  const inOrder = [...entries].sort((a, b) => byTabPlace(a.place, b.place));
  const byFacts = new Map(inOrder.map((e) => [e.facts, e]));
  const kept = applyFilter(inOrder.map((e) => e.facts), onTab(f));
  const shown = SORTS.includes(f.sort ?? "") ? sortGroups(kept, f) : kept;
  return shown.map((facts) => byFacts.get(facts)!);
}

/** What the state dropdown offers: the six entries, the chosen one marked,
 *  each counted over the rows the project and the search let through. */
export function jobsStateOptions(facts: RowFacts[], f: SpecsFilter): { key: string; count: number; on: boolean }[] {
  const chosen = jobsStateFilter(f.state).key;
  const counted = facts.filter((g) => (!f.project || g.project === f.project) && matchesSearch(g, f));
  return JOBS_STATE_FILTERS.map((s) => ({
    key: s.key,
    count: counted.filter((g) => matchesStateFilter(s, g)).length,
    on: s.key === chosen,
  }));
}

/** What the project dropdown offers: every project ("" first), then each
 *  project with a row on the tab, by name, plus the chosen one when it has
 *  none; each counted over the rows the state entry and the search let through. */
export function jobsProjectOptions(facts: RowFacts[], f: SpecsFilter): { project: string; count: number; on: boolean }[] {
  const entry = jobsStateFilter(f.state);
  const counted = facts.filter((g) => matchesStateFilter(entry, g) && matchesSearch(g, f));
  const projects = [...new Set([...facts.map((g) => g.project), ...(f.project ? [f.project] : [])])].sort((a, b) => a.localeCompare(b));
  return [
    { project: "", count: counted.length, on: !f.project },
    ...projects.map((project) => ({ project, count: counted.filter((g) => g.project === project).length, on: project === f.project })),
  ];
}

/** Where a heading's link goes: a column not sorted by goes to its first
 *  direction; the sorted one in its first direction turns round; turned round,
 *  back to the tab's own order. */
export function jobsSortPatch(f: SpecsFilter, key: string): { sort: string; dir: string } {
  const first = SORT_DEFAULT_DIR[key]!;
  if (f.sort !== key) return { sort: key, dir: "" };
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : first;
  if (dir !== first) return { sort: "", dir: "" };
  return { sort: key, dir: first === "asc" ? "desc" : "asc" };
}

/** A view link on the Jobs tab: always to `/`, always naming its state entry,
 *  so an address that names any view key is the whole view (`jobsViewChoice`). */
export function jobsViewPath(f: SpecsFilter, patch: SpecsFilter): string {
  return queuePath(f, { state: jobsStateFilter(f.state).key, ...patch }, "/");
}
