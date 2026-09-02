// The questions actually asked of this list: which chip a reader has
// picked, which column it is sorted by, and what a search term matches
// against.

import { IN_FLIGHT } from "../../../ui/job-state.ts";
import { t, type Language, type TranslationKey } from "../../../../i18n/index.ts";
import { ARCHIVED_OPEN_STATE, ARCHIVED_STATE, type QueueFilter, type SpecGroup } from "./types.ts";

// "Problems" holds everything that did not simply finish — a cap-stop
// and a crash are different, but both are things you go looking for on
// purpose.
//
// "Active" is FIRST, and that position is the whole of what makes
// it the default: `stateFilter` falls back to `STATE_FILTERS[0]`, so
// moving it changes the default filter for every reader. It held "All"
// until spec 221 folded the archive onto this list — at which point
// "All" started meaning all, archived specs included, and the reading
// view every tab sits on needed a chip of its own to be.
//
// `excludeStates` exists for that one entry and no other. An allow-list
// cannot say "every state but this one" without naming every job state
// there is, which is a list that goes stale the first time a state is
// added; the exception is what this entry IS, so it says so.
//
// The three in the middle are untouched by spec 221 BY CONSTRUCTION:
// none of them names `ARCHIVED_STATE`, so each already excludes an
// archived row without a line of new code.
export const STATE_FILTERS: { key: string; label: string; states?: string[]; excludeStates?: string[] }[] = [
  // All first, and therefore the default (see DEFAULT_STATE_FILTER): a
  // spec that reaches the archive stays on the list a reader is already
  // looking at, instead of disappearing from it. Measured before the
  // swap — the whole archive renders in the same tenth of a second the
  // active-only view does, so nothing here waits on paging.
  { key: "all", label: "All" },
  { key: "not-archived", label: "Active", excludeStates: [ARCHIVED_STATE] },
  // Read off `IN_FLIGHT` rather than written out a second time: a state
  // added to one and forgotten in the other is exactly the drift this
  // page cannot afford, and the single-job page needs the same set.
  { key: "active", label: "Running", states: [...IN_FLIGHT] },
  { key: "done", label: "Done", states: ["done"] },
  {
    key: "problem",
    label: "Problems",
    // An archive that left its own branch open did not simply finish
    // either, and it read as `failed` here before spec 221 gave it a
    // row of its own.
    states: ["failed", "stopped", "interrupted", "cancelled", ARCHIVED_OPEN_STATE],
  },
  { key: ARCHIVED_STATE, label: "Archived", states: [ARCHIVED_STATE, ARCHIVED_OPEN_STATE] },
];

/** The default, by position and not by name — so a chip moved to the
 *  front is the default, and nothing has to be told twice. */
export const DEFAULT_STATE_FILTER = STATE_FILTERS[0]!;

/** `STATE_FILTERS`' own `label` field stays English — it is a fixed key
 *  for `stateFilter()`'s own lookup, not what the page draws (spec 350).
 *  What the page draws is this, keyed by the chip's `key` and read
 *  through `t()`, so a reader in `nb` mode sees "Alle"/"Aktive"/… while
 *  the filter logic above keeps matching on the same untranslated keys
 *  it always has. */
const STATE_FILTER_LABEL_KEYS: Record<string, TranslationKey> = {
  all: "list.state.all",
  "not-archived": "list.state.active",
  active: "list.state.running",
  done: "list.state.done",
  problem: "list.state.problem",
  [ARCHIVED_STATE]: "list.state.archived",
};

export function stateFilterLabel(key: string, lang: Language): string {
  return t(lang, STATE_FILTER_LABEL_KEYS[key] ?? "list.state.all");
}

export const SORTS = ["started", "spec", "state", "cost", "created"];
// The default view: the newest spec MADE at the top (spec 317, REQ-3).
// Folder order was the default from 2026-08-19 (chosen over "last
// activity", which put a spec that had just been created at the bottom
// of the list — under everything that had ever run) until a real
// Created column made sorting by the date itself possible, rather than
// by the folder number that used to stand in for it.
export const DEFAULT_SORT = "created";
// Each column has the direction you almost always want first: newest
// run, dearest job, but names from A.
export const SORT_DEFAULT_DIR: Record<string, "asc" | "desc"> = {
  started: "desc", cost: "desc", spec: "desc", state: "asc", created: "desc",
};

export function stateFilter(
  key: string | undefined,
): { key: string; states?: string[]; excludeStates?: string[] } {
  return STATE_FILTERS.find((f) => f.key === key) ?? DEFAULT_STATE_FILTER;
}

/** Whether one chip admits one state. Written once because `applyFilter`
 *  decides which rows are RENDERED with it and `filterBar` decides what
 *  each chip's count SAYS with it — two answers to one question is how
 *  a chip comes to read "(0)" over a table with rows in it. */
export const matchesState = (
  f: { states?: string[]; excludeStates?: string[] },
  state: string,
): boolean => (!f.states || f.states.includes(state)) && !(f.excludeStates ?? []).includes(state);

/** Whether this view can show an archived spec at all (spec 221).
 *
 *  The server asks before it builds the rows: the walk over every
 *  archived folder is the one expensive thing on this route, aide alone
 *  has about 150 of them, and the default view — which is what nearly
 *  every open tab sits on, refreshing itself on every change event —
 *  must never pay for it. One exported rule rather than a second
 *  reading of the query string in `serve.ts`, so the gate and the
 *  filter can never disagree about which chips show what. */
export function filterShowsArchived(state: string | undefined): boolean {
  return matchesState(stateFilter(state), ARCHIVED_STATE);
}

/** Whether a row is an archived spec's, whichever of the two states it
 *  carries. Read wherever the ROW SHAPE is the question rather than the
 *  filter's — which is the routing in `groupRows` and the chip counts. */
export const isArchivedRow = (g: SpecGroup): boolean =>
  g.state === ARCHIVED_STATE || g.state === ARCHIVED_OPEN_STATE;

/** Everything the search reads, as one lowercase haystack. The WHOLE
 *  description, not the two lines a row shows: a term found in the
 *  clipped tail still turns up its row, and the note under the field
 *  says as much. Off `SpecGroup`, so one matcher reads a live spec and
 *  an archived one — the "across active AND archived" half of spec 221
 *  falls out of there being one row shape rather than two. */
const haystack = (g: SpecGroup): string =>
  `${g.project}:${g.specFolder}\n${g.title ?? ""}\n${g.description ?? ""}`.toLowerCase();

/** A term of nothing but spaces is no search at all: it must not empty
 *  the list. */
export const matchesSearch = (g: SpecGroup, f: QueueFilter): boolean => {
  const term = (f.q ?? "").trim().toLowerCase();
  return !term || haystack(g).includes(term);
};

export function applyFilter(groups: SpecGroup[], f: QueueFilter): SpecGroup[] {
  const chip = stateFilter(f.state);
  return groups.filter(
    (g) =>
      matchesState(chip, g.state) &&
      (!f.project || g.project === f.project) &&
      matchesSearch(g, f),
  );
}

// A spec folder leads with its number, and that number is what a person
// reads the column by — so `81-…` sorts before `103-…`, which plain text
// order gets wrong the moment there are three digits. Same number (or
// no number: a state, a create job's provisional key) falls back to text.
function compareFolders(a: string, b: string): number {
  const na = Number.parseInt(a, 10), nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export function sortGroups(groups: SpecGroup[], f: QueueFilter): SpecGroup[] {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const sign = dir === "asc" ? 1 : -1;
  // Every row's Time cell shows its own summed duration now, live or
  // archived (`activeDurationCell`/`archiveDateCell`, spec 281 made the
  // live half match spec 273's archived one) — a column that DRAWS one
  // figure has to SORT by that figure, for both kinds of row alike, or
  // a click on "Time" reorders the page by a number nobody can see.
  const key = (g: SpecGroup): number | string =>
    sort === "cost" ? g.spentUsd
    : sort === "spec" ? g.specFolder
    : sort === "state" ? g.state
    // REQ-5: a spec git could not date sorts as the epoch — the oldest
    // possible date, and the least surprising place for "unknown" to
    // land in a list that opens newest-first — never a job's own time.
    : sort === "created" ? (Date.parse(g.createdAt ?? "") || 0)
    : (g.totalDurationMs ?? 0);
  return [...groups].sort((a, b) => {
    const x = key(a), y = key(b);
    const cmp =
      (typeof x === "string" ? compareFolders(String(x), String(y)) : (x as number) - (y as number)) * sign;
    if (cmp !== 0) return cmp;
    // Only between two specs that have BOTH never run AND that git
    // could date neither of. A general folder tie-break is not free: 29
    // job fixtures sharing one date all tie and keep their insertion
    // order, and a tie-break on the name would re-sort every one of
    // them — a row moving for a reason nobody asked about. (This used
    // to name a sharper harm: it moved the 25-row cap onto the wrong
    // end of the list. Spec 226 removed the cap, not the reason.)
    // Never-run specs have no insertion order worth keeping — theirs is
    // whatever the disk scan happened to produce.
    //
    // `!g.lead` is what "never run" reads as since spec 199: it is
    // absent exactly for a group `emptyGroup` built, which is the same
    // set the old `activityAt === 0` test named. The datability half is
    // new — two never-run specs git CAN date sort by their real dates,
    // and only when neither has one is there nothing left to sort by.
    if (!a.lead && !b.lead && !a.createdAt && !b.createdAt) {
      return b.specFolder.localeCompare(a.specFolder);
    }
    return 0;
  });
}
