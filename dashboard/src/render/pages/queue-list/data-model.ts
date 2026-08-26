// The spec list's data model: SpecGroup (one row's worth of state, built
// from either live jobs or an archived spec's own record), the phase
// lines it carries, and the filtering/sorting a reader's chosen view
// applies to a collection of them. Split out of queue-list.ts (2026-08-26)
// — everything here is pure data transformation, nothing draws HTML.

import { type PhaseOutcome } from "../../../project/parse-phase-outcome.ts";
import { currentWorkRoundJobs } from "../../../queue/queue.ts";
import {
  IN_FLIGHT,
  anyCostUnmeasured,
  currentStep,
  inFlight,
  type BranchView,
  type QueueRowView,
} from "../../ui/job-state.ts";

export interface QueueTarget {
  project: string;
  specFolder: string;
  title?: string;
  /** What the spec is about, from `## Description` in 1-description.md.
   *  Shown on the job page, so a reader stops leaving the dashboard to
   *  find out what a job called `02-job-detail-view` actually is. */
  description?: string;
  phase?: string;
  /** What this spec builds on, from its own `Depends on:` line (spec
   *  92). Named by folder, the way `aide-run-spec`'s own dependency
   *  refusal names it. Empty or absent when it names none. */
  dependsOn?: string[];
  /** Steps this spec has already had, from the runner's own commits
   *  (spec 154). Marked, never forbidden. */
  done?: string[];
  /** Steps whose latest commit STOPPED, by step, with the reason —
   *  `timeout`, `budget_exhausted`. Such a step has run and has not
   *  finished, and the row says so instead of "not run yet" even once
   *  the queue's own memory of that attempt is gone. */
  stopped?: Record<string, string>;
  /** What `4-status.md`'s own line claims. Not what anything is decided
   *  from — the history above is — but the row wears a qualifier when
   *  the two disagree, which is how a copied folder or a killed run
   *  becomes visible rather than silently wrong. */
  fileSteps?: string[];
  /** The steps the file and the history do not agree about — said on
   *  the phase line it is about, never once per phase. */
  fileDisagrees?: string[];
  /** Where the spec's folder is on this machine. Server-side only — it
   *  is what the freshness check runs git in, and an absolute path has
   *  no business on a page. */
  dir?: string;
  /** The commit this spec's history starts AFTER, from its own
   *  `**Reopened:**` mark (spec 198). Server-side only, like `dir`: it
   *  is what the two git readers exclude with `--not`, so that a spec
   *  reopened for another round shows no phase as run before anything
   *  has run in it. Absent for the overwhelming majority. */
  reopenedAfter?: string;
  /** The description was committed after the last finished analyze, so
   *  the plan on disk describes an older problem than the description
   *  states. Derived live at render time, never stored, exactly like
   *  the merge check: a re-run clears it by being newer. */
  analyzeStale?: boolean;
  /** When this spec was MADE — the first commit that touched its folder
   *  (spec 199). It is what the "Started" column holds and what the
   *  `started` sort orders by, and it comes from git rather than from
   *  any job: a job's own start moves every time a phase runs, and the
   *  queue forgets a job once two hundred newer ones exist. Absent when
   *  git could not answer, and then the cell shows a dash — never a
   *  job's time, which would put the movement straight back. */
  createdAt?: string;
  /** Nothing has yet asked git anything about this spec (spec 208).
   *  Not "no step has run" — that is a real answer — and the row says
   *  "checking…" rather than draw a done-set, a Started date and a
   *  staleness badge it has no answers for. Set by the server when
   *  `refreshSpecCaches` has not reached this spec yet, and true for at
   *  most one poll interval after a restart. */
  freshnessUnknown?: boolean;
  /** Why the last archive run did NOT move the folder, from the spec's
   *  own `## Archive held back` section. Archive is the one phase whose
   *  file-truth is always false for a row still on this page — a spec
   *  whose folder moved has left the list — so "held back, and why" is
   *  the only file-side answer archive has to give. */
  archiveHeldBack?: { reason: string };
}


/** An ARCHIVED spec, as this list draws it (spec 221).
 *
 *  It came from `render/archive-page.ts`, which held the `/archive`
 *  page until that page retired: everything the Archive tab could do is
 *  done from a chip on this list now, so the shape it read moved here
 *  rather than being written a second time. Nothing about the fields
 *  changed in the move — the comments are the ones the archive page
 *  wrote them with.
 *
 *  It is deliberately NOT a `QueueTarget`: a target is a spec the queue
 *  may RUN, and the one thing an archived spec may be asked for is
 *  `reopen` (`ARCHIVE_ONLY_STEP`, queue.ts). Two shapes, because they
 *  answer two questions. */
export interface ArchivedSpecView {
  /** Which project's archive it came out of. */
  project: string;
  /** The spec's folder, which is also its number — what a person calls
   *  it when they go looking for it. */
  folder: string;
  /** Its H1, when `1-description.md` has one. */
  title?: string;
  /** The prose under `## Description`, whole. The cell shows two lines
   *  of it and the search reads all of it — cutting it here would make
   *  the two disagree. */
  description?: string;
  /** When it was archived: the `4-status.md` stamp, or failing that the
   *  commit that last touched the folder. `null` when neither answers,
   *  and the row says so in words rather than leaving the cell blank. */
  archivedAt: string | null;
  /** Its own `aide/<folder>` is STILL on origin (spec 193): the spec
   *  was archived and its work never landed. Derived from origin rather
   *  than from the job, because this is the half that reaches a spec
   *  whose job the queue's LRU cap evicted long ago — 146's case, which
   *  carried no failure reason at all. */
  notLanded?: boolean;
  /** Its branch is open because the project reviews its code (spec 220),
   *  not because the landing failed. Takes precedence over `notLanded`,
   *  which is derived from the same fact and would otherwise say the
   *  opposite of what happened. */
  prOpen?: boolean;
  /** The request itself, when the run managed to open one. Absent where
   *  `gh` could not — and then the row says the branch is open with
   *  nothing describing it, which is a state worth seeing. */
  prUrl?: string;
  /** When that answer was last taken — epoch ms, the checker's own
   *  cache stamp (spec 208). The set is whatever a background schedule
   *  last found, so how OLD it is decides how much of it to believe:
   *  the mark says so, the same way `driftNote` labels a commits-behind
   *  count. Absent for a row carrying no mark, and for one whose answer
   *  has never been taken. */
  notLandedCheckedAt?: number;
  /** Nobody has yet asked git when this spec was archived (spec 208).
   *  Only a spec whose `4-status.md` carries no `Archived:` stamp can
   *  reach git at all, so this is the shrinking minority of a shrinking
   *  minority — and the cell says "checking…" for it rather than
   *  `date unknown`, which is what a spec git ASKED about and could not
   *  date says. */
  dateChecking?: boolean;
  /** What the spec cost in TIME: its phases added together, in
   *  milliseconds, off the `Time spent (ms)` stamp its archive landing
   *  wrote into `4-status.md` (spec 207). Absent for every spec
   *  archived before that stamp existed, and the cell is then genuinely
   *  blank — not `date unknown`, not a dash: a figure nobody recorded is
   *  different from a value that could not be found. */
  durationMs?: number;
  /** Which steps the spec's own `4-status.md` CLAIMS it has had (spec
   *  224). It is what the row's phase lines and its pip strip are drawn
   *  from, and it is the file's own unverified word — deliberately, and
   *  as the only affordable source rather than as a shortcut. A live
   *  row's done-set is git-verified through `workflowHistory`'s cache,
   *  and `refreshSpecCaches` never warms that cache for an archived
   *  spec: that is the unbounded cost spec 178's plan review rejected,
   *  so reusing the live path here would read `{history: null}` for
   *  every archived row and say "checking…" for ever. */
  done: string[];
  /** What each phase actually ran on, from `4-status.md`'s own `Model
   *  (<step>):` lines (spec 244) — never the queue's job history, which
   *  the archive outlives, and never the configured default, which is a
   *  fact about a run that never happened (the same reason `modelPicker`
   *  draws nothing at all on a locked row). Keyed by step; a step the
   *  file names nothing for is simply absent from the map. */
  models: Record<string, string>;
  /** What each phase's OWN file records about its own run (spec 245's
   *  write side, spec 247's read side): Model, Time spent and Cost,
   *  keyed by step. A different source from `models` above — spec 245's
   *  one-record-per-phase-file format, never `4-status.md`'s old
   *  step-suffixed lines — and the two are merged, new preferred, where
   *  `readerGroup()` builds `Phase.model`. A step the file names nothing
   *  for is absent from the map, exactly as `models` leaves one out. */
  phaseOutcomes: Record<string, PhaseOutcome>;
}


/** This page's own pseudo-states for an archived spec (spec 221). No job
 *  ever carries either: they are what a reader ROW is, and they are the
 *  values the chips are defined against — the older chips exclude a
 *  settled archived row because none of them lists this first string.
 *
 *  TWO of them, because being archived answers "did this spec finish"
 *  with certainty only while nothing of the spec is still open (spec
 *  193). A spec archived with its own branch still on origin has not
 *  finished; it has always been on the reading view, and the chip
 *  defined by excluding archived specs must not be what finally takes
 *  it off. So it is archived to the Archived chip, a problem to the
 *  Problems chip, and not-archived to the one that means "everything
 *  still going on" — three answers that fall out of one extra value
 *  rather than out of an exception inside the filter.
 *
 *  The row is the same either way, and so is the word in its State
 *  cell: what tells the two apart on the page is the "not landed" mark,
 *  which is the fact the reader has to act on. */
export const ARCHIVED_STATE = "archived";
const ARCHIVED_OPEN_STATE = "archived-unlanded";


export interface QueueFilter {
  state?: string;
  project?: string;
  sort?: string;
  dir?: string;
  /** A plain search term (spec 221), matched against the three fields
   *  `SEARCHED` names — folder, title and the WHOLE description, not
   *  the two lines the row shows. It came off the archive page, which
   *  had the only search on this dashboard; it reads live and archived
   *  rows alike now, because they are rows on one list. */
  q?: string;
  /** Which specs are expanded: `<project>/<folder>`, comma-separated.
   *  A row is COLLAPSED unless it is named here — the list is a wall of
   *  controls otherwise, and the reader came to read states. It rides in
   *  the query string with the rest of the filter, which is the whole
   *  reason it survives the five-second swap of the table — `swapRows`
   *  sends `location.search` back on every tick. Never rendered as text:
   *  only compared for membership, and re-encoded through `queueHref`. */
  open?: string;
}


// Exported since spec 160: `queue.ts` keeps the same list under
// `PHASE_STEPS` — it decides which steps a running job may still be
// given — and the render layer does not import that module. A test
// reads both and refuses to let them drift.
export const QUEUE_STEPS = ["analyze", "implement", "archive"];

// The phase LINES a spec's expanded row shows, in order. `create` is
// history, not a control (spec 116): a spec that exists cannot be
// created again, so it is never a checkbox (`phaseSubRows`), never a
// progress pip (`specHeadRow`), and never "the next phase"
// (`nextStep`/`readyPhase`/`allDone`) — all four of those keep reading
// `QUEUE_STEPS` directly. Only the phase-line list reads this one.
//
// Exported (spec 247) so `serve.ts` can iterate the same four steps
// while reading each one's phase-outcome file, rather than keeping a
// second, hand-copied list of them.
export const PHASE_LINES = ["create", ...QUEUE_STEPS];


// --- the list ---------------------------------------------------------------

// The questions actually asked of this list. "Problems" holds
// everything that did not simply finish — a cap-stop and a crash are
// different, but both are things you go looking for on purpose.
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
  { key: "not-archived", label: "Active", excludeStates: [ARCHIVED_STATE] },
  { key: "all", label: "All" },
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

export const SORTS = ["started", "spec", "state", "cost"];
// The default view: newest spec at the top. Chosen 2026-08-19 over
// "last activity", which put a spec that had just been created at the
// bottom of the list — under everything that had ever run.
export const DEFAULT_SORT = "spec";
// Each column has the direction you almost always want first: newest
// run, dearest job, but names from A.
export const SORT_DEFAULT_DIR: Record<string, "asc" | "desc"> = {
  started: "desc", cost: "desc", spec: "desc", state: "asc",
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
  `${g.specFolder}\n${g.title ?? ""}\n${g.description ?? ""}`.toLowerCase();

/** A term of nothing but spaces is no search at all: it must not empty
 *  the list. */
export const matchesSearch = (g: SpecGroup, f: QueueFilter): boolean => {
  const term = (f.q ?? "").trim().toLowerCase();
  return !term || haystack(g).includes(term);
};

// --- one spec, however many jobs it took -------------------------------------

// The list is about SPECS. A spec taken through analyze,
// implement and archive as three separate jobs is still one spec, and
// how far it has got should read without counting rows.

/** Every step this job has anything to say about: the ones it finished,
 *  plus the one it is on. */
function stepsTouched(r: QueueRowView): string[] {
  const finished = (r.results ?? []).map((x) => x.step).filter((s): s is string => !!s);
  return [...new Set([...finished, currentStep(r)])];
}

/** The job as ONE of its steps saw it. Same shape as the job, so every
 *  cell that renders a job renders a step without knowing the
 *  difference — but with that step's own outcome and its own cost, not
 *  the job's running total. A step the job finished is done (or failed,
 *  and then it keeps the error); a step it has not reached yet is not an
 *  attempt at all. */
function attemptFor(r: QueueRowView, step: string): QueueRowView | null {
  const res = (r.results ?? []).find((x) => x.step === step);
  if (res) {
    return {
      ...r,
      state: res.ok ? "done" : r.state === "done" ? "failed" : r.state,
      spentUsd: res.costUsd,
      spentTokens: res.tokens,
      error: res.ok ? undefined : r.error,
    };
  }
  if (currentStep(r) !== step) return null;
  // What the finished steps did not account for. A job's `spentUsd` is
  // the sum over its steps, so the step in flight owns the remainder.
  const counted = (r.results ?? []).reduce((sum, x) => sum + x.costUsd, 0);
  // The same remainder in tokens — but only where there is one to take.
  // A job with no token figure has no remainder either, and subtracting
  // from nothing would invent a zero.
  const countedTokens = (r.results ?? []).reduce((sum, x) => sum + (x.tokens ?? 0), 0);
  return {
    ...r,
    spentUsd: Math.max(0, r.spentUsd - counted),
    spentTokens: r.spentTokens === undefined ? undefined : Math.max(0, r.spentTokens - countedTokens),
  };
}

function activityMs(r: QueueRowView): number {
  return Date.parse(r.startedAt ?? r.createdAt) || 0;
}

/** How long ONE step of a job took, or has taken so far (spec 199).
 *
 *  Nothing stores a per-step duration. A job carries a single
 *  `startedAt` however many steps it ran, so `finishedAt - startedAt`
 *  is the whole job's span and belongs to no one step of it — reaching
 *  for that is the one mistake this function exists to prevent. What
 *  does exist is an end per finished step (`results[i].at`), and a
 *  step's own span runs from where the step before it ended, or from
 *  the job's own start for the first one.
 *
 *  `live` marks the step being worked right now: its figure is elapsed,
 *  not settled, and the browser takes over counting it from `since`. */
interface PhaseDuration {
  ms: number;
  live: boolean;
  /** The instant to count up from, on a live one. */
  since: string;
}

export function phaseDuration(r: QueueRowView, step: string, now: number): PhaseDuration | null {
  const results = r.results ?? [];
  const boundary = (i: number): string | undefined =>
    (i > 0 ? results[i - 1]!.at : undefined) ?? r.startedAt;
  const index = results.findIndex((x) => x.step === step);
  if (index !== -1) {
    const end = results[index]!.at;
    const start = boundary(index);
    if (!end || !start) return null;
    const ms = Date.parse(end) - Date.parse(start);
    return Number.isNaN(ms) ? null : { ms, live: false, since: start };
  }
  // Not among the finished steps, so the only way it has a span at all
  // is by being the one in flight.
  if (currentStep(r) !== step || !inFlight(r)) return null;
  const start = boundary(results.length);
  if (!start) return null;
  const ms = now - Date.parse(start);
  return Number.isNaN(ms) ? null : { ms, live: true, since: start };
}

/** The spec's own total: its phases' durations added together, and only
 *  once nothing is left to run (spec 199).
 *
 *  A sum, never a span. A spec that sat three days between analyze and
 *  implement did not take three days — the calendar is not the work,
 *  which is the whole reason this is built out of the phase lines
 *  rather than out of the first and last timestamps.
 *
 *  "Nothing left to run" is every runnable phase being done and no job
 *  in flight. It is NOT `nextPhase`, which always names archive for a
 *  spec still on this page — the list is where an unarchived spec
 *  lives, so that question is always answered "archive" here. */
function totalDuration(
  phases: Phase[],
  done: readonly string[],
  all: QueueRowView[],
): number | undefined {
  if (!QUEUE_STEPS.every((s) => done.includes(s))) return undefined;
  if (all.some(inFlight)) return undefined;
  let total = 0;
  let measured = false;
  for (const p of phases) {
    // The attempt the LINE speaks for — its latest — so a phase re-run
    // three times contributes once, and an earlier failed retry's time
    // is not summed in beside it.
    const latest = p.attempts[0];
    // `now` is never read: the in-flight guard above means no phase
    // here can come back live, and a settled span is measured between
    // two recorded instants. Zero rather than a clock, so this function
    // gives the same answer whenever it is asked.
    const d = latest ? phaseDuration(latest, p.step, 0) : null;
    if (!d || d.live) continue;
    total += d.ms;
    measured = true;
  }
  return measured ? total : undefined;
}

/** The spec's own total, for a caller that has the jobs and the
 *  done-set but not a rendered group (spec 207).
 *
 *  Lifted out of `jobGroup` so the archive-time write into
 *  `4-status.md` and the figure this page draws are ONE function. The
 *  repo already carries four hand-paired pairs whose two halves have to
 *  be edited together — `WORKFLOW_STEPS`, `DEPENDENCY_GATED_STEPS`,
 *  project readiness, `worktreeLinks` — and "the stored figure equals
 *  what the list showed" is that shape by default. It is not one here
 *  because there is only one implementation of it.
 *
 *  `done` is a PARAMETER, never worked out from `rows`. The list's own
 *  comes from `withFreshness`, which takes `analyze` back OUT of the
 *  set when the description was committed after the last analyze ran —
 *  even though a job did complete it. A second derivation from the job
 *  results would disagree in exactly that case, and store a figure the
 *  list itself would not have shown.
 *
 *  The phase lines are rebuilt here rather than passed in for the same
 *  reason: a caller that had to assemble them first would be a second
 *  place that knows which lines a spec's total is a sum over. */
export function computeSpecTotalDurationMs(
  rows: QueueRowView[],
  done: readonly string[],
): number | undefined {
  return totalDuration(specPhases(rows), done, rows);
}

/** The phase lines a spec's row and a spec's total are both built over:
 *  the four in order, then anything else that ran, each with the
 *  attempts that speak for it, newest first. */
function specPhases(all: QueueRowView[]): Phase[] {
  const recent = [...all].sort((a, b) => activityMs(b) - activityMs(a));
  const extra = [...new Set(all.flatMap(stepsTouched))].filter((s) => !PHASE_LINES.includes(s));
  return [...PHASE_LINES, ...extra].map((step) => ({
    step,
    attempts: recent.map((r) => attemptFor(r, step)).filter((a): a is QueueRowView => a !== null),
    history: {},
  }));
}

/** The three-line join `jobGroup` and `emptyGroup` each composed inline
 *  (spec 239): `specPhases` for the lines themselves, then archive's own
 *  held-back reason and each phase's git history layered on top. Shared
 *  now because a third caller — the spec page's own Overview tab —
 *  needs the identical join, and writing it a third time is the exact
 *  hand-copied-list shape `development.md` already names six of. */
export function phasesFor(all: QueueRowView[], target: QueueTarget | undefined): Phase[] {
  return specPhases(all).map((phase) => ({
    ...phase,
    ...heldBackFor(phase.step, target),
    ...historyFor(phase.step, target),
  }));
}

export interface Phase {
  step: string;
  /** Every job whose current/last step is this phase, newest first. A
   *  phase can be re-run — `85-dashboard-into-aide` archived three
   *  times — so this is a list, not a job. */
  attempts: QueueRowView[];
  /** Archive only: the spec's own reason for not having been archived.
   *  Every other phase answers "has this happened" out of `done`. */
  heldBack?: { reason: string };
  /** What this phase's own git history says beyond whether it happened
   *  (spec 154): why its last run did not finish, and whether
   *  `4-status.md` agrees that it ran at all. */
  history: { stopped?: string; fileDisagrees?: boolean };
  /** What this phase ran on, when it is a LOCKED phase's own record
   *  (spec 244) — from `ArchivedSpecView.models`, never set for a live
   *  phase (whose "what it ran on" is `attempts[0]?.model`, read
   *  through the picker's pre-fill instead). */
  model?: string;
  /** What this LOCKED phase's own record says it cost, in time and
   *  money (spec 247) — from `ArchivedSpecView.phaseOutcomes`, on the
   *  same terms as `model` above: never set for a live phase, whose
   *  duration and cost come from `attempts[0]` instead. */
  timeSpentMs?: number;
  cost?: number;
  costUnmeasured?: boolean;
}

export interface SpecGroup {
  project: string;
  specFolder: string;
  /** Whether `specFolder` is a real folder or a create job's provisional
   *  key. The key says nothing to anyone, which is why the row keeps the
   *  title while it stands (`specSummary`, 2026-08-21) and drops it once
   *  the spec has landed and the folder name IS the title. */
  named: boolean;
  /** The job the header speaks for: whatever is in flight, or failing
   *  that the most recently active one. Absent for a spec nothing has
   *  ever run — there is no job page to link to, and no honest answer
   *  to "is it in flight?". */
  lead?: QueueRowView;
  // There was a `latest` here — the most recently active job — and the
  // "Started" column showed ITS time, so the column and the sort both
  // answered "when did anything last happen to this spec?" and every
  // run threw the row back to the top of the list. Spec 199 replaced
  // that question with `createdAt` below, and nothing else ever read
  // the field. The recency ORDER survives it: `jobGroup` still sorts
  // the jobs by activity to pick the one the header speaks for.
  /** `not-started` and `archived` are this page's own pseudo-states, not
   *  a job's: a spec that exists and has never been run, and a spec
   *  whose folder has moved into `archive/`. They are the filter keys
   *  and the CSS suffixes; the words the reader sees are "not started"
   *  and "archived". */
  state: QueueRowView["state"] | "not-started" | "archived" | "archived-unlanded";
  spentUsd: number;
  /** Whether any step summed into `spentUsd` was over-charged rather
   *  than measured (spec 152). Rolled up across every job the spec has
   *  had, because the cell it marks is the same roll-up. */
  costUnmeasured: boolean;
  /** The same roll-up in tokens, absent while no job under this spec has
   *  reported any (spec 118). */
  spentTokens?: number;
  /** When the spec was made, off its target and therefore off git
   *  (spec 199). Absent for a spec git could not date, and for a create
   *  job whose folder is not on disk yet. */
  createdAt?: string;
  /** How long the spec's phases took, added together — the work, not
   *  the calendar (spec 199). Absent while anything is still left to
   *  run, and absent for a spec no phase of which has a measurable
   *  span. A spec that waited three days between two phases did not
   *  take three days, which is why this is a SUM of measured phases and
   *  never `last finished - first started`.
   *
   *  Not DRAWN on the list since 2026-08-24 — beside "3 h ago" the
   *  figure read as noise — but still computed: it is the same sum
   *  `archive` writes into `4-status.md` (spec 207), and the group
   *  carrying it keeps the two readers on one source. */
  totalDurationMs?: number;
  /** Every repo this SPEC has a branch in, however many jobs made them.
   *  Folded by label from rows already on the page — the server folds
   *  the same thing by root when the Merge button posts back, and that
   *  one is the authority. Nothing here decides where git runs. */
  branches: BranchView[];
  /** The pull request a `pr`-mode run opened for this spec's code branch
   *  (spec 220), off the most recently active job that reported one. A
   *  project whose code is reviewed archives with that branch still on
   *  origin, deliberately and for as long as the review takes — so the
   *  row has to say where the review IS, or a reader has no way to tell
   *  it from a landing that got stuck. */
  prUrl?: string;
  /** Why `gh` opened none. The other half of the same answer, and the
   *  more urgent one: this is a branch left unmerged with nothing
   *  describing it, which no amount of waiting will resolve. */
  prError?: string;
  phases: Phase[];
  /** Steps this spec has already had, from its matching target: what its
   *  own files show, and what the queue actually ran. Marked on the
   *  row's checkboxes, never forbidden — re-analyzing after the code
   *  moved on is a legitimate thing to want. */
  done: string[];
  /** What the spec is and how far it has got, from its own 4-status.md.
   *  It used to be one summary line for whichever spec the top form's
   *  dropdown had selected; every row now answers for itself. */
  title?: string;
  /** What the spec is about, whole (spec 221). Never DRAWN on a live
   *  spec's row — `specSummary` decides what that line says, and the
   *  description is not on it — but the search reads it, and a search
   *  that reached an archived spec's prose and not a live one's would
   *  be two filters wearing one field's name. */
  description?: string;
  phase?: string;
  /** The specs this one builds on, by folder — from its own
   *  1-description.md, not from anything the queue ran. */
  dependsOn: string[];
  /** This spec's description has moved on since its last analysis. The
   *  analyze line says so; nothing is blocked by it. */
  analyzeStale: boolean;
  /** Nothing has yet asked git anything about this spec (spec 208).
   *  The row draws "checking…" where it would otherwise state a fact it
   *  does not have. */
  freshnessUnknown?: boolean;
  /** The archived spec this row speaks for (spec 221). Present exactly
   *  when `state` is `archived`, and it is what the reader row draws
   *  from: the date, the mark, the recorded duration and the link.
   *  Absent on every other row, which has jobs and a target instead. */
  archive?: ArchivedSpecView;
}

/** Fold branch entries by label, most-recently-active row winning a
 *  given label. The rows arrive newest-first, so the first sighting of
 *  a label is the one to keep. */
function branchesOf(recent: QueueRowView[]): BranchView[] {
  const byLabel = new Map<string, BranchView>();
  for (const row of recent) {
    for (const b of row.branchUrls ?? []) {
      if (!byLabel.has(b.label)) byLabel.set(b.label, b);
    }
  }
  return [...byLabel.values()];
}

export const groupKey = (project: string, specFolder: string): string => `${project}/${specFolder}`;

// A spec with no job is still a spec. It is the ONLY row on this page
// where the whole workflow is still ahead of you, which is exactly the
// row the analyze button belongs on.
function emptyGroup(t: QueueTarget): SpecGroup {
  return {
    project: t.project,
    specFolder: t.specFolder,
    // It came from a target, so the folder is on disk by construction.
    named: true,
    state: "not-started",
    spentUsd: 0,
    costUnmeasured: false,
    branches: [],
    phases: phasesFor([], t),
    ...fromTarget(t),
  };
}

/** What a row reads off its own spec rather than off its jobs. Written
 *  once because both constructors need it, and a row showing another
 *  spec's done-set or progress is the one way this join can go wrong. */
function fromTarget(
  t: QueueTarget | undefined,
): Pick<
  SpecGroup,
  | "done"
  | "title"
  | "description"
  | "phase"
  | "dependsOn"
  | "analyzeStale"
  | "createdAt"
  | "freshnessUnknown"
> {
  return {
    done: t?.done ?? [],
    title: t?.title,
    // Read but not drawn: the search's third field (spec 221).
    description: t?.description,
    phase: t?.phase,
    dependsOn: t?.dependsOn ?? [],
    analyzeStale: t?.analyzeStale ?? false,
    freshnessUnknown: t?.freshnessUnknown,
    // From the TARGET and from nowhere else (spec 199). There is
    // deliberately no fallback to a job's own `createdAt`/`startedAt`:
    // that is the field this change exists to stop reading, and a
    // fallback would leave the row jumping for exactly the specs git
    // cannot date.
    createdAt: t?.createdAt,
  };
}

/** Archive's own file-side answer, on archive's line and nowhere else.
 *  Written once because both constructors build their phases. */
const heldBackFor = (step: string, t: QueueTarget | undefined): { heldBack?: { reason: string } } =>
  step === "archive" && t?.archiveHeldBack ? { heldBack: t.archiveHeldBack } : {};

/** The git-side answer for one phase (spec 154), for the same reason
 *  `heldBackFor` exists: both constructors build their phases, and a
 *  phase reading another phase's stop reason is the one way this join
 *  can go wrong.
 *
 *  The disagreement is asked per step, not per spec: one line of one
 *  file covers all five, but the row has a line per phase and the same
 *  sentence down all five of them is the duplication spec 143 already
 *  took off this page once. */
const historyFor = (
  step: string,
  t: QueueTarget | undefined,
): { history: { stopped?: string; fileDisagrees?: boolean } } => ({
  history: { stopped: t?.stopped?.[step], fileDisagrees: t?.fileDisagrees?.includes(step) },
});

const isCreate = (r: QueueRowView): boolean => r.steps.includes("create");

export function groupBySpec(
  rows: QueueRowView[],
  targets: QueueTarget[],
  archived?: string[],
  archivedSpecs?: ArchivedSpecView[],
): SpecGroup[] {
  const byKey = new Map<string, QueueRowView[]>();
  for (const r of rows) {
    const key = groupKey(r.project, r.specFolder);
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  const byKeyTarget = new Map(targets.map((t) => [groupKey(t.project, t.specFolder), t]));
  const known = new Set(byKeyTarget.keys());
  // Which projects we are entitled to judge. An empty target list is
  // "we do not know", never "everything is archived": a specs root that
  // is not checked out on this host looks exactly the same from here,
  // and a project losing its whole history to a momentarily unreadable
  // disk is not recoverable by a filter.
  const judgeable = new Set(targets.map((t) => t.project));
  const archivedSet = new Set(archived ?? []);
  const fromJobs = [...byKey.entries()]
    // Archived beats every other reason to keep a group visible. An
    // unreadable specs root and an in-flight create job both argue for
    // showing something anyway; a folder already in archive/ answers
    // "did this spec finish" with certainty, so none of the other
    // branches get a vote. The check used to sit on the create branch
    // alone, and a project with no other live target still slipped an
    // archived spec's row through `judgeable` — every phase reading
    // "not run yet" under a job reporting done (spec 134).
    // There was an exception here until spec 221: a spec whose own
    // branch is STILL on origin kept its JOB row, archived or not (spec
    // 193), because a row was the only way to see that its work had
    // never landed. It had to come through this path because there was
    // no other — so it read as an ordinary, fully-interactive job row,
    // offering a Run the server would have refused. Every archived spec
    // gets a reader row now, and spec 193's answer rides on that row as
    // a MARK (`ArchivedSpecView.notLanded`) instead of as a reason to
    // draw one. The two must not be re-separated: a second, different
    // kind of archived row is what 1-description.md rules out by name.
    .filter(
      ([key, all]) =>
        !archivedSet.has(key) &&
        // A create job's spec is not a known target BY CONSTRUCTION: the
        // folder is what the job is making, and until it lands there is
        // nothing on disk to match. Without this it would be filtered out
        // in exactly the projects that already have specs — so the job the
        // reader just started would render nothing at all.
        (known.has(key) || !judgeable.has(all[0]!.project) || all.some(isCreate)),
    )
    .map(([key, all]) => [key, currentWorkRoundJobs(all)] as const)
    .filter(([, all]) => all.length > 0)
    .map(([key, all]) => jobGroup(all, byKeyTarget.get(key)));
  return [
    ...fromJobs,
    // Only ever a list the server chose to build: under the default
    // filter it is absent, and this adds nothing at all.
    ...(archivedSpecs ?? []).map(readerGroup),
    ...targets.filter((t) => {
      const jobs = byKey.get(groupKey(t.project, t.specFolder));
      return !jobs || currentWorkRoundJobs(jobs).length === 0;
    }).map(emptyGroup),
  ];
}

/** An archived spec's row: a record, not a control (spec 221).
 *
 *  It goes through neither `jobGroup` nor `emptyGroup`, and that is the
 *  point. Both build a row off JOBS — a lead job to speak for it, an
 *  attempt per phase — and an archived spec's jobs are gone from the
 *  queue's two-hundred-deep memory for all but the newest of them.
 *
 *  It is still the same ROW, though, and since spec 224 it is drawn by
 *  the same builder: `isArchivedRow` is what locks it, and the lock is
 *  what keeps every control on it from offering a press the server
 *  would refuse (`ARCHIVE_ONLY_STEP`, queue.ts). There were two row
 *  builders until then, kept level by hand, and they had already
 *  drifted — no fold and no phase lines on one side only.
 *
 *  The four phases, therefore, and not the `phases: []` this built
 *  until spec 224: the row opens now, and what it opens on is what the
 *  spec's own `4-status.md` claims. No `attempts`, because there is no
 *  job to attribute one to — `wordPhase` renders a truthful "done" from
 *  `happened` alone, so the lines and the pip strip are correct without
 *  one, and the duration and cost cells are simply blank. */
function readerGroup(s: ArchivedSpecView): SpecGroup {
  return {
    project: s.project,
    specFolder: s.folder,
    // It came out of a folder on disk, so the name IS the spec's.
    named: true,
    // The one place the two archived states are told apart.
    state: s.notLanded ? ARCHIVED_OPEN_STATE : ARCHIVED_STATE,
    spentUsd: Object.values(s.phaseOutcomes).reduce((sum, o) => sum + (o.cost ?? 0), 0),
    costUnmeasured: Object.values(s.phaseOutcomes).some((o) => o.costUnmeasured),
    branches: [],
    // Spec 247: `outcome?.model` — spec 245's new, one-record-per-file
    // format — wins over `s.models[step]` — spec 244's old,
    // `4-status.md`-only format — when both could theoretically apply.
    // They never do for the same real archive (`2-analysis.md`,
    // "Findings"), so this is a merge order, not a live disagreement.
    phases: PHASE_LINES.map((step) => {
      const outcome = s.phaseOutcomes[step];
      return {
        step,
        attempts: [],
        history: {},
        model: outcome?.model ?? s.models[step],
        timeSpentMs: outcome?.timeSpentMs,
        cost: outcome?.cost,
        costUnmeasured: outcome?.costUnmeasured,
      };
    }),
    done: s.done,
    title: s.title,
    description: s.description,
    dependsOn: [],
    analyzeStale: false,
    archive: s,
  };
}

function jobGroup(all: QueueRowView[], target: QueueTarget | undefined): SpecGroup {
  const recent = [...all].sort((a, b) => activityMs(b) - activityMs(a));
  const spec = fromTarget(target);
  const lead = recent.find(inFlight) ?? recent[0]!;
  // The five, always, in order — a phase nobody has run yet still holds
  // its place, which is what makes progress readable at a glance. A
  // step outside them (explore, manifest) is appended rather
  // than dropped: a job that ran is never invisible. `create` is one of
  // the five since spec 116, so a create job lands on its own line at
  // the front rather than being appended after archive.
  // Built before the group, because the spec's total is a sum over
  // these same lines and re-deriving them would be two answers to one
  // question. `phasesFor` is where that join lives now (spec 239) —
  // the file-side answers this page shows on a line are added on top of
  // it, and the total reads neither.
  const phases: Phase[] = phasesFor(all, target);
  return {
    project: lead.project,
    specFolder: lead.specFolder,
    lead,
    state: lead.state,
    spentUsd: all.reduce((sum, r) => sum + r.spentUsd, 0),
    costUnmeasured: all.some((r) => anyCostUnmeasured(r.results)),
    // Summed over the jobs that HAVE a figure, and absent when none
    // does — so a spec whose runs all predate spec 118 shows a dash
    // rather than a total of nothing.
    spentTokens: all.some((r) => r.spentTokens !== undefined)
      ? all.reduce((sum, r) => sum + (r.spentTokens ?? 0), 0)
      : undefined,
    branches: branchesOf(recent),
    // Newest-first, so the first job that reported one wins — the same
    // rule `branchesOf` folds branch labels by.
    prUrl: recent.find((r) => r.prUrl)?.prUrl,
    prError: recent.find((r) => r.prError)?.prError,
    phases,
    // The same roll-up shape as `spentUsd` above, over time instead of
    // money — and one figure per phase LINE, not per attempt: a phase
    // re-run three times contributes the attempt its line speaks for,
    // the way the line's own cell does. Only once nothing is left to
    // run, because a total of a spec still working is a number that
    // will be wrong in a minute.
    totalDurationMs: computeSpecTotalDurationMs(all, spec.done),
    ...spec,
    // A create job has no target to read a title off — the spec it is
    // making is not on disk yet — so the job's own title is the row's.
    // Only as a fallback: once the spec has landed, the folder's own
    // 1-description.md is the better answer, and the one every other
    // row already uses.
    title: spec.title ?? all.find((r) => r.createTitle)?.createTitle,
    // Whether the name above the line is a real folder or a placeholder.
    // A target IS the folder on disk, so a group without one is a create
    // job whose spec has not landed and whose name is a provisional key
    // that says nothing to anyone — the one case where the title has to
    // stay on the row (see `specSummary`).
    named: !!target,
  };
}

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
  const key = (g: SpecGroup): number | string =>
    sort === "cost" ? g.spentUsd
    : sort === "spec" ? g.specFolder
    : sort === "state" ? g.state
    // Spec 199: when the spec was MADE. It used to be the most recent
    // job's own start, so starting a phase moved the row.
    : Date.parse(g.createdAt ?? "") || 0;
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
