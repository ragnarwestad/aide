// The spec page's own view types.

import type { JobDetailView, JobStepResultView, SpecFileView } from "../job-page.ts";
import type { Phase, QueueTarget } from "../queue-list.ts";

/** One row of `4-status.md`'s Tasks tables, as the page shows it (spec
 *  182). `phase` and `line` are the row's identity: the checks form
 *  names the row by them so the server can refuse a row that has
 *  moved. */
export interface SpecCheckView {
  phase: string;
  line: string;
  task: string;
  done: boolean;
}

/** The spec's checks, on the Overview tab (specs 182, 188, 212).
 *
 *  `rows` is every row in the file, done ones included. `phase` is the
 *  one phase whose open rows may be TICKED — the first section still
 *  carrying an open mark, which is what the spec list's own column
 *  shows. A row already done is a check already made, and a row in a
 *  phase the workflow has not reached is a check nothing is waiting on;
 *  both are shown, neither is a box.
 *
 *  One `phase` for the whole set rather than one per tickable row is
 *  what makes each box's own value the row's verbatim line: a table row
 *  contains `|` and cannot be packed into one field with its phase
 *  beside it. `baseSha` is the file's own commit at read time, the same
 *  guard the description's form carries. */
export interface SpecChecksView {
  rows: SpecCheckView[];
  /** The file's own current phase. Carried for a reader of the view;
   *  which rows are BOXES no longer follows from it — only the
   *  `## Acceptance criteria` rows are ever tickable (see `checklist`). */
  phase?: string;
  baseSha?: string;
}

export interface SpecPageView {
  project: string;
  specFolder: string;
  /** The spec's H1, when 1-description.md has one. */
  title?: string;
  /** The four files, in the order they are written and read. */
  files: SpecFileView[];
  /** Whatever is in flight, or failing that the last thing that
   *  happened. Absent for a spec nothing has ever run — which is the
   *  whole reason this page is keyed on the spec and not on a job id. */
  lead?: JobDetailView;
  /** Every step from every job in this spec's current work round,
   *  oldest job first, tagged with its attempt number when there is
   *  more than one job (spec 242) — replaces the attempt picker.
   *  The server always sets it, empty jobs list included — optional
   *  only in the same sense `phases?`/`done?` above already are (spec
   *  239/241): a view built before this field existed (or by a test
   *  fixture that has no reason to care about it) leaves it absent
   *  rather than every caller having to spell out `steps: []`. */
  steps?: JobStepResultView[];
  /** The spec's own run history, the same four-phase (plus any extra
   *  step) chain the front page's row draws (spec 239) — read off the
   *  same source, never recomputed. Absent only for a view built before
   *  this field existed; the server always sets it, empty jobs list
   *  included. */
  phases?: Phase[];
  /** Steps this spec's own files say have happened, the other half
   *  `phasePips` needs to mark a phase done rather than todo. From the
   *  same target `phases` above is built from. */
  done?: string[];
  /** Whether the spec has been archived (spec 163). Its folder has
   *  moved into `archive/` and the spec is a RECORD: the description's
   *  textarea was built for a description edited while the work is live
   *  (spec 162), and a Save on an archived spec would have written,
   *  committed and pushed into `archive/`. */
  archived?: boolean;
  /** Closed rather than archived (spec 406, REQ-7) — a spec whose idea
   *  did not hold, recorded with the reason it was closed. Always
   *  `false` unless `archived` is also `true`: the folder physically
   *  moves the same way either way, and this is what tells the two
   *  apart everywhere the page reads `archived` to mean "record,
   *  nothing editable" — `closedLine` draws in place of `archivedLine`
   *  when this is set, and `closeControl` stays hidden alongside
   *  `resetControl` for the same `view.archived` check both already
   *  make. */
  closed?: boolean;
  /** The reason typed by the person who closed this spec (REQ-5), and
   *  when — off the `**Closed:**` stamp. Present only when `closed` is. */
  closedDate?: string;
  closeReason?: string;
  /** Where the Update button posts. Built by the server, because only
   *  it knows the action's own path. */
  updateAction: string;
  /** Confirmation page for starting a new work round on an active spec. */
  resetAction?: string;
  /** Why Reset cannot be selected at this instant. */
  resetUnavailableReason?: string;
  /** Confirmation page for closing a spec that is not going to work
   *  (spec 406, REQ-1) — present in every phase Reset's own control is,
   *  absent once the spec is archived (closed included: `closeControl`
   *  checks `view.archived` the same way `resetControl` does). */
  closeAction?: string;
  /** Why Close cannot be selected at this instant (REQ-11) — the same
   *  busy reason `resetUnavailableReason` reads, since a job in flight
   *  or a landing in progress blocks either lifecycle move alike. */
  closeUnavailableReason?: string;
  /** Where the PDF button opens (spec 358) — a plain `GET`, streamed
   *  inline, never a form. */
  pdfAction?: string;
  /** Why the PDF button cannot be pressed — `md-to-pdf` missing on the
   *  serving host, drawn disabled with this as its reason rather than
   *  hidden (REQ-7). */
  pdfUnavailableReason?: string;
  /** Where the Description tab's Save posts. */
  saveAction: string;
  /** Where the Overview tab's checks form posts (spec 212). Its own
   *  route, and therefore its own commit: a person no longer has to
   *  open the description's editor in order to tick a box. */
  tickAction: string;
  /** The queue's token, when the site has one — the Reopen control
   *  posts to `/api/queue` like every other lifecycle action, and that
   *  route checks it. Absent leaves the field out entirely rather than
   *  posting an empty one, exactly as `tokenField` does on the list. */
  token?: string;
  /** The spec's own checks (spec 182). Absent for a spec whose
   *  `4-status.md` has no phase section at all. */
  checks?: SpecChecksView;
  /** What the spec depends on, resolved to live folders the way the
   *  runtime gate resolves it (spec 166's line may hold a bare number,
   *  and a hand-edited one usually does). Read-only on Overview; the
   *  ticks of the Description tab's picker. Empty and neither is drawn
   *  at all. */
  dependsOn?: string[];
  /** What this spec MAY be made to depend on: every active spec in its
   *  own project, itself left out. Empty — a project whose only spec is
   *  this one — and the picker is not drawn (spec 174). */
  dependsOnOptions?: QueueTarget[];
  /** Whether the spec's own Tracking info says acceptance ticking is not
   *  required (spec 394) — read fresh off `1-description.md`
   *  (`specAcceptanceNotRequired`), the same file `dependsOn` above
   *  comes from. Absent/false means "required", exactly as no line at
   *  all does (REQ-11). */
  acceptanceNotRequired?: boolean;
  /** Where the banner's combined depends-on/acceptance form posts (spec
   *  394) — its own route, since the banner is drawn once per page load
   *  regardless of which document tab is open, unlike `saveAction`
   *  below, which belongs to whichever tab's own textarea is showing. */
  trackingAction: string;
  /** The commit whichever document tab's own file was read at, carried
   *  through that tab's form so a save whose file has moved since can be
   *  refused (spec 310: one field, since only one tab's form is ever
   *  drawn per request). Absent for a file git has never committed,
   *  which is not a mismatch. */
  formBaseSha?: string;
  /** Why the last pull changed nothing, and what it did when it did —
   *  both off the query string, the same round-trip Approve, Cancel and
   *  Merge already use. */
  error?: string;
  notice?: { note: string; ok: boolean };
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. */
  backHref?: string;
  /** Where the "Start board" form posts (spec 388). Absent means no
   *  control is drawn at all — the round is unavailable on this host, or
   *  this spec's own code branch carries no commits (REQ-1). */
  boardAction?: string;
  /** Where the "Stop board" form posts, once a board is up. */
  boardStopAction?: string;
  /** Why the control is disabled while `boardAction` IS present — a
   *  transient reason (another job running, a landing in progress), the
   *  same disabled-with-reason shape `resetUnavailableReason` uses. */
  boardUnavailableReason?: string;
  /** The board's own live status (REQ-4), read off the registry on every
   *  render — absent means none has ever been started for this spec's
   *  current branch. */
  board?: BoardStatusView;
}

/** A board's status, as the spec page shows it (spec 388). Named
 *  `status`, never `state`: a repo-wide guard
 *  (test/queue/store/transitions.test.ts's REQ-6b) reserves the literal
 *  "state:" for a queue JOB's own state, and a board's lifecycle is an
 *  unrelated concept the guard's naive text match cannot tell apart from
 *  it. */
export interface BoardStatusView {
  status: "starting" | "running" | "failed";
  branch: string;
  commit: string;
  /** Set once the round has reported itself up (REQ-4). */
  url?: string;
  /** Set once the board has failed to start. */
  error?: string;
}
