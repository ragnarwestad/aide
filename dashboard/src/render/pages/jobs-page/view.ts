// The Jobs tab's view rules, as pure functions: which state entries it offers,
// what a scheduled job's row is to the filter and the sort, which rows
// a view leaves and in what order, what the state dropdown offers and counts, and
// where a view link goes. The filter and the sort are the Specs list's own,
// run over the facts a row has; the bar and the page draw what this decides.

import { inFlight, type QueueRowView } from "../../ui/job-state";
import {
  ACTIVE_FILTER_KEY,
  NOT_VERIFIED_KEY,
  SORTS,
  SORT_DEFAULT_DIR,
  STATE_FILTERS,
  applyFilter,
  chosenStates,
  matchesSearch,
  matchesStateFilter,
  sortGroups,
  toggledState,
  type SpecGroup,
  type SpecsFilter,
} from "../specs-list/data-model";
import { queuePath } from "../specs-list/filter-bar.ts";
import { byTabPlace, jobRowKind, jobTitle, type TabPlace } from "./rows.ts";

export interface JobsFilter extends SpecsFilter {
  kind?: string;
}

export const JOBS_KIND_FILTERS = ["all", "spec", "deploy", "schedule", "cleanup", "group"] as const;
type JobsKind = (typeof JOBS_KIND_FILTERS)[number];
const kindEntries = JOBS_KIND_FILTERS.map((key) => ({ key }));

export const jobsKindFilters = (value: string | undefined): { key: JobsKind }[] =>
  chosenStates(kindEntries, value);

export const jobsKindValue = (value: string | undefined): string =>
  jobsKindFilters(value).map((entry) => entry.key).join(",");

/** The state entries the Jobs tab offers: All, Active, Running, Waiting,
 *  Done, Stopped, Failed, Not verified. Active is every state Done does not
 *  hold, under the Specs list's key so it takes the list's label. Archived and
 *  Closed are the tab's Done. */
const JOBS_STATE_KEYS = ["all", "active:all", "waiting", "stopped", "failed", NOT_VERIFIED_KEY];
const doneState = { key: "done", label: "Done", states: ["done", "archived", "closed"] } as (typeof STATE_FILTERS)[number];
const activeState = { key: ACTIVE_FILTER_KEY, label: "Active", excludeStates: doneState.states } as (typeof STATE_FILTERS)[number];
const baseJobStates = STATE_FILTERS.filter((s) => JOBS_STATE_KEYS.includes(s.key));
export const JOBS_STATE_FILTERS = [baseJobStates[0]!, activeState, ...baseJobStates.slice(1, 3), doneState, ...baseJobStates.slice(3)];

/** The entry a key names on this tab: one it does not offer is All. */
export const jobsStateFilters = (value: string | undefined): (typeof JOBS_STATE_FILTERS)[number][] =>
  chosenStates(JOBS_STATE_FILTERS, value);

export const jobsStateValue = (value: string | undefined): string =>
  jobsStateFilters(value).map((entry) => entry.key).join(",");

/** Whether the view's state part is All: no entry narrows it. */
const choosesAll = (value: string | undefined): boolean => jobsStateFilters(value)[0]!.key === JOBS_STATE_FILTERS[0]!.key;

/** The view's state value when it names an entry other than All, which opens every group card it shows. */
export const jobsStateOpensGroups = (value: string | undefined): string | undefined =>
  choosesAll(value) ? undefined : jobsStateValue(value);

/** What the filter and the sort read off a row. */
export type RowFacts = Pick<
  SpecGroup,
  | "project" | "specFolder" | "title" | "description" | "state" | "notVerified" | "failed"
  | "spentUsd" | "createdAt" | "totalDurationMs" | "lead"
> & {
  /** Group members represented by this row; an ordinary spec or job counts as one. */
  itemCount?: number;
  /** The member specs a group's row stands for, each its current row with its own state; absent on every other row. */
  members?: RowFacts[];
};

/** What the state entries match and count for a row: a group's member specs, any other row itself. */
const stateRows = (row: RowFacts): RowFacts[] => row.members ?? [row];

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

/** A scheduled job's facts: its title as the row shows it, its state
 *  with a landing read as running (as a spec's group reads it), its cost, the
 *  moment it was made and its time. No criteria, so never Not verified. */
export function jobFacts(row: QueueRowView, now: number): RowFacts {
  return {
    project: row.project,
    specFolder: row.specFolder,
    title: jobTitle(row),
    state: row.landing ? "running" : row.state,
    spentUsd: row.spentUsd,
    createdAt: row.createdAt,
    totalDurationMs: jobDurationMs(row, now),
    lead: row,
  };
}

/** The view with its state entry resolved for this tab: an entry the tab does
 *  not offer (an old `archived` or `closed` link) is All, before anything is
 *  filtered or counted. The tab's view holds no project: the search finds one. */
const onTab = (f: JobsFilter): SpecsFilter => ({ ...f, state: "all", project: undefined });

const rowKind = (facts: RowFacts): Exclude<JobsKind, "all"> => {
  if (facts.itemCount !== undefined && !facts.lead) return "group";
  return facts.lead ? jobRowKind(facts.lead) : "spec";
};

/** The rows the view shows, in its order: the search cuts them as
 *  `applyFilter` does, and a state entry keeps a row one of whose state rows
 *  it matches (All keeps every row); a column the view names orders them
 *  as `sortGroups` does; with none, newest created first. */
export function jobsViewRows<E extends { facts: RowFacts; place: TabPlace }>(entries: E[], f: JobsFilter): E[] {
  const inOrder = [...entries].sort((a, b) => byTabPlace(a.place, b.place));
  const byFacts = new Map(inOrder.map((e) => [e.facts, e]));
  const tabFilters = jobsStateFilters(f.state);
  const kinds = jobsKindFilters(f.kind);
  const searched = applyFilter(inOrder.map((e) => e.facts), { ...onTab(f), state: "all" });
  const kept = searched.filter((facts) =>
    (choosesAll(f.state) || stateRows(facts).some((row) => tabFilters.some((entry) => matchesStateFilter(entry, row)))) &&
    kinds.some((entry) => entry.key === "all" || entry.key === rowKind(facts))
  );
  const shown = sortGroups(kept, f);
  return shown.map((facts) => byFacts.get(facts)!);
}

/** What the state dropdown offers: the entries, the chosen ones marked, each
 *  counting the specs and jobs the searched rows stand for, each once, by its own state. */
export function jobsStateOptions(facts: RowFacts[], f: SpecsFilter): { key: string; count: number; on: boolean; state: string }[] {
  const chosen = jobsStateFilters(f.state);
  const counted = facts.filter((g) => matchesSearch(g, f));
  return JOBS_STATE_FILTERS.map((s) => ({
    key: s.key,
    count: counted.reduce((sum, g) => sum + stateRows(g).filter((row) => matchesStateFilter(s, row)).length, 0),
    on: chosen.some((entry) => entry.key === s.key),
    state: toggledState(JOBS_STATE_FILTERS, chosen, s.key),
  }));
}

/** What the Kind part offers, counted over the same searched rows as State. */
export function jobsKindOptions(facts: RowFacts[], f: JobsFilter): { key: JobsKind; count: number; on: boolean; kind: string }[] {
  const chosen = jobsKindFilters(f.kind);
  const counted = facts.filter((row) => matchesSearch(row, f));
  return JOBS_KIND_FILTERS.map((key) => ({
    key,
    count: counted
      .filter((row) => key === "all" || rowKind(row) === key)
      .reduce((sum, row) => sum + (row.itemCount ?? 1), 0),
    on: chosen.some((entry) => entry.key === key),
    kind: toggledState(kindEntries, chosen, key),
  }));
}

/** Where a heading's link goes: a column not sorted by goes to its first
 *  direction; the sorted one in its first direction turns round; turned round,
 *  back to newest created first. */
export function jobsSortPatch(f: JobsFilter, key: string): { sort: string; dir: string } {
  const first = SORT_DEFAULT_DIR[key]!;
  if ((SORTS.includes(f.sort ?? "") ? f.sort : "created") !== key) return { sort: key, dir: "" };
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : first;
  if (dir !== first) return { sort: "", dir: "" };
  return { sort: key, dir: first === "asc" ? "desc" : "asc" };
}

/** A view link on the Jobs tab: always to `/`, always naming its state entry,
 *  so an address that names any view key is the whole view (`jobsViewChoice`). */
export function jobsViewPath(f: JobsFilter, patch: JobsFilter): string {
  return queuePath(f, { state: jobsStateValue(f.state), kind: jobsKindValue(f.kind), ...patch }, "/");
}
