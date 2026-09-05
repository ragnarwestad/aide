// The shapes the spec list's data model trades in: what a live spec's
// own target carries, what an archived spec's record carries, the
// filter a reader's chosen view applies, and the row shape (SpecGroup)
// everything else on this page is built from.

import { type PhaseOutcome } from "../../../../project/parse-phase-outcome.ts";
import { type QueueRowView } from "../../../ui/job-state.ts";
import { type FileStepsAnswer } from "../../../../git/workflow-history.ts";
import type { Sentence } from "../../../../i18n/message.ts";

export interface QueueTarget {
  project: string;
  specFolder: string;
  title?: string;
  /** What the spec is about, from `## Description` in 1-description.md.
   *  Shown on the job page, so a reader stops leaving the dashboard to
   *  find out what a job called `02-job-detail-view` actually is. */
  description?: string;
  phase?: string;
  /** The `## Acceptance criteria` heading with an open row, from the
   *  SAME parse that produced `phase` (spec 302) — request-scoped, on
   *  `specPageView`'s own local `target`, never on the shared
   *  five-second scan `phase` itself comes from. */
  acceptancePhase?: string;
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
  /** What the spec's own files claim, kept apart by source (spec 362):
   *  `4-status.md`'s prose line, and `4-status.json`'s own
   *  `completedPhases` when this spec has a state file. Not what
   *  anything is decided from — the history above is, unless a state
   *  file exists, in which case IT is (`resolveWorkflowState`) — but
   *  the row wears a qualifier when the sources disagree, which is how
   *  a copied folder, a killed run, or a stale hand-edited prose line
   *  becomes visible rather than silently wrong. */
  fileSteps?: FileStepsAnswer;
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
  /** Nobody has yet asked git for this spec's creation date (spec 317)
   *  — `SpecCreatedAtChecker.peekCreatedAt`'s own `checkedAt === null`,
   *  carried onto the target rather than lost the moment `createdAt`
   *  collapses "never asked" and "asked, unanswerable" into the same
   *  `undefined`. The Created cell draws "checking…" for this, and a
   *  dash for a real, timestamped `null`. */
  createdAtChecking?: boolean;
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
  /** No `4-status.json` exists for this spec yet (spec 355, REQ-10) — a
   *  spec no writer script (aide-run-spec, aide-archive-spec,
   *  aide-write-spec) has touched since this feature shipped. The row
   *  still shows; it is labeled as missing its state file rather than
   *  silently falling back to a fresh parse of the prose beside it. */
  stateMissing?: boolean;
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
  /** A landing merged this spec's branch but left it on origin because
   *  the delete failed (spec 319) — the reason `notLanded` is true, when
   *  it is known. `undefined` means either the branch is not open at all,
   *  or it is open for a reason no landing recorded (a spec whose branch
   *  genuinely never merged). Takes precedence over the bare `NOT_LANDED`
   *  wording for the same reason `prOpen` takes precedence over it. */
  branchDeleteError?: Sentence | Sentence[];
  /** When the spec was made, from BEFORE the archive step's own `git
   *  mv` (spec 317, REQ-6) — distinct from `archivedAt` above, which is
   *  when the folder was moved. Off `firstCommitAtFollowingRenames`,
   *  never off a plain directory pathspec against the post-move path:
   *  that would answer with the archive date a second time, which is
   *  exactly the repeat REQ-6 rules out. Absent for a spec git could
   *  not date this way either. */
  createdAt?: string;
  /** Nobody has yet asked git for this spec's creation date (spec 317)
   *  — the same "checking…" distinction `dateChecking` draws for the
   *  archive date, over the separate question. */
  createdAtChecking?: boolean;
  /** Nobody has yet asked git when this spec was archived (spec 208).
   *  Only a spec whose `4-status.md` carries no `Archived:` stamp can
   *  reach git at all, so this is the shrinking minority of a shrinking
   *  minority — and the cell says "checking…" for it rather than
   *  `date unknown`, which is what a spec git ASKED about and could not
   *  date says. */
  dateChecking?: boolean;
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
  /** Closed rather than archived (spec 406, REQ-7) — the `**Closed:**`
   *  stamp's presence. `readerGroup()` reads this before `notLanded` to
   *  pick `CLOSED_STATE` over either archived state: a closed spec's
   *  code branch is deleted, never left open for review, so `notLanded`/
   *  `prOpen` never legitimately apply to one — but this is checked
   *  first regardless, rather than assumed exclusive. */
  closed?: boolean;
  /** The reason typed by the person who closed it (REQ-5), for the
   *  row's own detail. Present only when `closed` is. */
  closeReason?: string;
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
 *  The row is the same either way, but the word in its State cell is
 *  not (spec 275): a State cell that said "archived" for both, beside a
 *  red "not landed" mark for one of them, read as a flat contradiction
 *  on the same row — even when the mark was accurate. The cell now
 *  echoes the mark's own fact in words for `ARCHIVED_OPEN_STATE`
 *  (`head-row.ts`'s `stateBadge`), so the two never disagree. */
export const ARCHIVED_STATE = "archived";
export const ARCHIVED_OPEN_STATE = "archived-unlanded";
/** A spec closed rather than archived (spec 406, REQ-7) — its own state,
 *  never folded into either archived state above: a chip built to mean
 *  "finished work" (Archived) or "everything still going on"
 *  (not-archived/Active) would misdescribe a closed spec either way it
 *  joined, so it joins neither (see `STATE_FILTERS`, filter-sort.ts). */
export const CLOSED_STATE = "closed";

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

/** How the list is cut and ordered. One list, exported so `serve.ts`
 *  builds the redirect after a POST from the same five keys the forms
 *  send — two copies would eventually disagree about what "the view" is. */
export const FILTER_KEYS = ["state", "project", "sort", "dir", "open", "q"] as const;

/** The prefix a filter key rides under as a form field. Prefixed
 *  because one of the five is `project`, which is ALSO what the Run
 *  form posts to say which spec to run: two fields of that name arrive
 *  as a list, and the enqueue refuses the whole request as "invalid
 *  project". */
export const FILTER_FIELD_PREFIX = "view.";

/** What tells `POST /api/queue` that the press came from a row on THIS
 *  list (spec 221). Reopen is offered in two places — an archived
 *  spec's own page and its row here — and the two want the answer on
 *  different pages. A marker rather than a redirect target: where to go
 *  back to is the server's decision, and a page that took the
 *  destination from the browser would take it from anyone. */
export const FROM_LIST_FIELD = "fromList";

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
  /** What this phase ran at, when it is a LOCKED phase's own record
   *  (spec 364) — the sibling of `model` above, on the same terms: from
   *  `ArchivedSpecView.phaseOutcomes`, never set for a live phase (whose
   *  "what it ran at" is `attempts[0]?.effort`, read through the
   *  picker's pre-fill instead). */
  effort?: string;
  /** What this phase's own file record says it cost, in time and money
   *  (spec 247): from `ArchivedSpecView.phaseOutcomes` for a LOCKED
   *  phase, on the same terms as `model` above. For a LIVE phase (spec
   *  284) it is the fallback `specPhases` reads off the phase's own
   *  stamped file when `attempts` is empty — a queue-job attempt always
   *  wins when one exists, so this is set on a live phase only where
   *  `attempts[0]` has nothing to say. */
  timeSpentMs?: number;
  cost?: number;
  costUnmeasured?: boolean;
  tokens?: number;
  /** How many times this phase's own file says it has run (spec 341) —
   *  read regardless of how many queue-job attempts exist, unlike
   *  `timeSpentMs`/`cost`/`tokens` above: those speak for the LATEST
   *  attempt only, so the file is a fallback for when the queue has
   *  none; this is a running total, so the file has to be checked even
   *  when the queue has some, in case it remembers fewer than really
   *  happened. `phase-rows.ts` takes the larger of this and
   *  `attempts.length`. */
  attemptCount?: number;
}

export interface SpecGroup {
  project: string;
  specFolder: string;
  /** Whether `specFolder` is a real folder or a create job's provisional
   *  key. The key says nothing to anyone, which is why the row's own
   *  name reads the title instead while this is false (`specHeadRow`'s
   *  `spec` constant) and goes back to the folder name, as a link, once
   *  the spec has landed. */
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
  /** `not-started`, `archived` and `closed` are this page's own
   *  pseudo-states, not a job's: a spec that exists and has never been
   *  run, a spec whose folder has moved into `archive/`, and one moved
   *  there because it will not work (spec 406). They are the filter
   *  keys and the CSS suffixes; the words the reader sees are "not
   *  started", "archived" and "closed". */
  state: QueueRowView["state"] | "not-started" | "archived" | "archived-unlanded" | "closed";
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
   *  job whose folder is not on disk yet.
   *
   *  For a LOCKED row this is copied up from `archive.createdAt` (spec
   *  317) by `readerGroup()`, onto this same top-level field — the sort
   *  key and the Created cell both read it from here, whichever kind of
   *  row it is, rather than branching on `archive?.createdAt` at each
   *  call site. */
  createdAt?: string;
  /** Spec 317: nobody has yet asked git for this date — the Created
   *  cell then draws "checking…" rather than a dash, the same
   *  distinction `freshnessUnknown` draws for the done-set. Copied up
   *  from `archive.createdAtChecking` for a locked row, on the same
   *  terms as `createdAt` above. */
  createdAtChecking?: boolean;
  /** How long the spec's phases took, added together — the work, not
   *  the calendar (spec 199). A spec that waited three days between two
   *  phases did not take three days, which is why this is a SUM of
   *  measured phases and never `last finished - first started`. Absent
   *  for a spec no phase of which has a measurable span yet.
   *
   *  Drawn on EVERY row since spec 281, live or archived. Every attempt
   *  of every phase counts (spec 340) — a phase run three times
   *  contributes all three — and a phase currently in flight
   *  contributes its own elapsed-so-far, via `totalDurationSince` below,
   *  rather than being excluded until it settles. Two pipelines feed
   *  it: `computeSpecTotalDurationMs()` reads queue job records for a
   *  live row, `readerGroup()` reduces each phase file's own `Time
   *  spent:` line for an archived one (spec 273) — fed by the same
   *  underlying runs but not structurally pinned to agree
   *  (2-analysis.md, spec 281's "REQ-2" finding; spec 340's own
   *  analysis names the retried-phase case where they now diverge
   *  further). `activeDurationCell()` and `archiveDateCell()` are the
   *  two readers. */
  totalDurationMs?: number;
  /** The synthetic instant the row's own clock counts up from, while
   *  one of its phases is live (spec 340) — mirrors a phase line's own
   *  `since` (`Phase`'s per-attempt `PhaseDuration.since`). Absent
   *  whenever nothing under this spec is running. */
  totalDurationSince?: string;
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
  /** Why a step's push did not reach origin (spec 328), off the most
   *  recently active job that reported one — same aggregation as
   *  `prError`, its nearest sibling. The step still succeeded; only the
   *  branch itself was left stranded. */
  pushError?: string;
  /** REQ-4 (spec 327): the lead job's own unresolved landing failure,
   *  read straight off `lead` rather than scanned across every job for
   *  this spec the way `prError` is — see Risk analysis for why a
   *  cross-job scan would show the wrong job's failure. */
  landingError?: Sentence | Sentence[];
  /** Why the lead job's landing was refused, when it was — the same
   *  field the notice line reads. `tests-red` is the one member that
   *  makes the landing mark amber instead of red: the suite went red on
   *  the merged result, nothing was pushed, and implement runs again. */
  errorReason?: "conflict" | "held-back" | "tests-red" | "unlanded";
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

export const groupKey = (project: string, specFolder: string): string => `${project}/${specFolder}`;
