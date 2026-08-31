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
  phase?: string;
  /** The `## Acceptance criteria` section's own heading, when it has an
   *  open row (spec 299's follow-up) — tickable on top of `phase`, never
   *  behind it: those rows are the spec's own person to judge, and a
   *  run that left one of ITS OWN rows unticked before reporting done
   *  must not also lock the person out of the one section that was
   *  always theirs. Renders as a second, independent form. */
  acceptancePhase?: string;
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
  /** Where the Update button posts. Built by the server, because only
   *  it knows the action's own path. */
  updateAction: string;
  /** Confirmation page for starting a new work round on an active spec. */
  resetAction?: string;
  /** Why Reset cannot be selected at this instant. */
  resetUnavailableReason?: string;
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
  /** The commit `1-description.md` was read at, carried through the
   *  Description tab's form so a save whose file has moved since can be
   *  refused. Absent for a file git has never committed, which is not a
   *  mismatch. */
  descriptionBaseSha?: string;
  /** Why the last pull changed nothing, and what it did when it did —
   *  both off the query string, the same round-trip Approve, Cancel and
   *  Merge already use. */
  error?: string;
  notice?: { note: string; ok: boolean };
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. */
  backHref?: string;
}
