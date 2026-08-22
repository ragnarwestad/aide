// What a queued job looks like to a page, and how its state is put into
// words. Both the list and the single-job page need this, and neither
// owns it.

import { badge, stepLabel, type BadgeVariant, type MessageVariant, type PipKind } from "./components.ts";

/** One repo a spec pushed a branch to, as a page sees it: a NAME and a
 *  link, never the path git will be run in. The server re-derives every
 *  root itself when the Merge button posts back. */
export interface BranchView {
  /** The repo's directory basename — `aide`, `aide-specs`. */
  label: string;
  url: string;
  /** Where this branch can be TRIED, when the project's host builds a
   *  preview per branch (`.aide/project.yaml`'s `deployment.preview`).
   *  Set only on the repo that IS the project's own code — a repo
   *  holding a plan has nothing to try. */
  previewUrl?: string;
}

export interface QueueRowView {
  id: string;
  project: string;
  specFolder: string;
  /** What a `create` job is making, in words. A create job's
   *  `specFolder` is a provisional key until the spec lands, and a row
   *  labelled `new-abc123de` tells the reader nothing about what is
   *  running. Absent on every other job, whose spec has a real name. */
  createTitle?: string;
  steps: string[];
  stepIndex: number;
  /** The steps whose box a reader may still tick or untick while this
   *  job runs (spec 160): the tail that has not started, plus every
   *  later phase the job does not have. Worked out server-side, by the
   *  same function that decides what the edit route accepts — a box
   *  drawn live for an edit the store would refuse is a click that
   *  answers with a refusal instead of a change. Absent, or empty, for
   *  every job that is not running: then the row locks as it always
   *  did. */
  editableSteps?: string[];
  state:
    | "queued" | "running" | "done"
    | "stopped" | "failed" | "cancelled" | "interrupted";
  spentUsd: number;
  /** The same figure in tokens (spec 118). A NUMBER here, not the stored
   *  split: the page shows a compact total and nothing else, and the
   *  render layer has no business knowing the shape of a result file.
   *  Absent means nothing measured it — the cell shows a dash. */
  spentTokens?: number;
  timeoutSec: number;
  createdAt: string;
  startedAt?: string;
  stopReason?: "budget" | "timeout";
  /** Every repo this job pushed to, one entry each — a list even when it
   *  holds one, because `paceup` and `atlasaurus` (specs inside the
   *  project repo, one branch per job) are the NORMAL shape and must
   *  render through the same code as a two-repo job, not a fork of it.
   *  Derived live from git at render time, never stored on the job: the
   *  answer changes long after the job stops running. */
  branchUrls?: BranchView[];
  error?: string;
  /** Why the job's own landing was refused, when it was refused for
   *  something the row can offer a way out of. Stored on the job since
   *  spec 149 and read from here: a landing happens with nobody's
   *  browser attached, so the reason cannot ride in a redirect the way
   *  the Merge button's refusal used to. */
  errorReason?: "conflict";
  /** What this job ran on. Shown next to the cost, because a figure
   *  without its model cannot be compared with the next one. */
  model?: string;
  /** One entry per step the job has FINISHED, in the order they ran.
   *  A job is not one step: `steps[stepIndex]` names only the last one
   *  it reached, and placing a two-step job by that alone left the
   *  first step's line speaking for an older attempt (measured on spec
   *  90, 2026-08-17: a finished analysis read as failed). */
  results?: StepResultView[];
}

/** The little of a step's result the LIST needs. The job page's
 *  `JobStepResultView` carries more and stays assignable to this — one
 *  shape, seen at two altitudes. `step` is optional because a result
 *  written by an older runner has no step name; such an entry matches no
 *  phase rather than the wrong one. */
export interface StepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
  /** This step's own token total, absent when the run did not measure
   *  one. Per STEP, because a phase line speaks for its own attempt and
   *  not for the job's running total. */
  tokens?: number;
  /** Whether `costUsd` was READ off the tool's own output or stood in
   *  for it. A killed step is charged its whole budget, because a
   *  SIGKILLed run prints no usage — a ceiling, not a measurement.
   *  Absent means measured: every record written before the flag
   *  existed came from a run that printed its own figure. */
  costMeasured?: boolean;
}

/** Whether anything summed over these steps was a stand-in rather than a
 *  measurement. The job page's Steps table marks each step for itself;
 *  this is what the TOTALS built on top of them ask (spec 152), so a
 *  spec total of "41.13" cannot read as money spent when 35 of it is a
 *  ceiling nobody measured. */
export function anyCostUnmeasured(results: StepResultView[] | undefined): boolean {
  return (results ?? []).some((r) => r.costMeasured === false);
}

// A stopped job is NOT a failed one, and the two must never render as
// the same string: with tight caps a cap-stop is a common, healthy
// outcome, and a reader who cannot tell them apart ignores both.
export function stateLabel(r: QueueRowView): string {
  if (r.state === "stopped") {
    return r.stopReason === "timeout"
      ? `stopped — ${Math.round(r.timeoutSec / 60)} min`
      : "stopped — budget";
  }
  return r.state;
}

// A wall of identical grey rows hides the one thing you came to see.
// Colour carries the state; the label still says it in words, so the
// colour is never the only signal.
//
// Ten states, six badge variants. Five of them had an example on the
// design sheet; the other four are decided here and asserted by name in
// `test/design-system.test.ts`, because a mapping nobody drew is a
// mapping nobody checked:
//
//   stopped     — a cap-stop is a common, healthy outcome (see
//                 `stateLabel` above), so it takes the same amber as
//                 waiting: notice, not alarm.
//   failed      — a real failure, so danger.
//   interrupted — grouped with failed, as it always was.
//   cancelled   — a deliberate ending someone chose, not a failure.
export const BADGE_VARIANT: Record<QueueRowView["state"], BadgeVariant> = {
  queued: "idle",
  running: "running",
  done: "done",
  stopped: "waiting",
  failed: "refused",
  cancelled: "idle",
  interrupted: "refused",
};

export function stateChip(r: QueueRowView): string {
  return badge(BADGE_VARIANT[r.state], stateLabel(r));
}

/** What the badge says when nothing is running: the resting state and
 *  what can happen next, in one sentence. Handed in rather than worked
 *  out here, because none of it is the JOB's to know — `readyPhase` is
 *  the SPEC's answer, worked out by the caller from the spec's own
 *  files.
 *
 *  `mergeReady` was the third of them until spec 149. It said "ready to
 *  merge the code" for a branch a person was expected to press Merge
 *  for, and there is no such press any more: every step lands the work
 *  it produced, and the one branch left standing open is `implement`'s,
 *  which `archive` lands. `readyPhase` already says "ready for archive"
 *  on exactly that row, so the badge kept the answer and lost the
 *  duplicate. */
export interface RestingState {
  archiveHeldBack?: string;
  readyPhase?: string;
}

/** The SPEC row's own chip: a running job reads as "analyzing",
 *  "implementing" — the phase word IS the state, so the row needs no
 *  second sentence saying which step is on (asked for 2026-08-19). The
 *  phase LINES keep the plain "running": their line already names the
 *  phase, and doubling it would say "analyze analyzing".
 *
 *  Spec 132 made that one rule instead of one case: the first line is
 *  the verb for what is happening, or the resting state and what is
 *  next. `queued` said neither — one bare word, with the step it was
 *  waiting to run known all along — and `done` said the resting state
 *  without the half that matters, while the sentence disambiguating it
 *  sat one line lower. The order of the resting cases came from the
 *  sentence this badge replaced: a branch to merge outranks a phase to
 *  run, and a held-back archive outranks both. */
/** What a row says when nothing is running on it: the resting state,
 *  and what comes next.
 *
 *  The WORD only. The reason is a sentence out of `4-status.md` — 130
 *  characters on spec 141 — and a badge is `nowrap`, so it ran off the
 *  right edge of the table. It is said in full in the row's own panel
 *  instead (`specNotice`), once (spec 143).
 *
 *  Its own function since spec 176, because a spec with no job in the
 *  queue's memory needs the same sentence and had a hardcoded "not
 *  started" instead. That row's `readyPhase` was already computed and
 *  sitting unused, and the Run button beside the badge was already
 *  named from it — so the two could disagree on the very same row
 *  ("not started · Implement"). Sharing this makes them agree by
 *  construction. */
export function restingChip(resting: RestingState = {}): string {
  if (resting.archiveHeldBack) return badge("waiting", "archive held back");
  if (resting.readyPhase) return badge("ready", `ready for ${resting.readyPhase}`);
  return badge("done", "done — nothing waiting on you");
}

export function specStateChip(r: QueueRowView, resting: RestingState = {}): string {
  if (r.state === "running") return badge("running", gerund(currentStep(r)));
  if (r.state === "queued") return badge("idle", `${gerund(currentStep(r))} queued`);
  if (r.state === "done") return restingChip(resting);
  return stateChip(r);
}

/** "analyze" → "analyzing", "implement" → "implementing" — from the
 *  reader's word (`stepLabel`), so a future entry added to
 *  `STEP_LABELS` gerunds through the same rule rather than a second
 *  one. */
function gerund(step: string): string {
  const label = stepLabel(step);
  return label.endsWith("e") ? `${label.slice(0, -1)}ing` : `${label}ing`;
}

/** A spec that exists and has never been run. It is this page's own
 *  pseudo-state, so it has no `QueueRowView` to hand `stateChip` — but
 *  it must render through the same component, or the one row with no
 *  job would be the one row with hand-written markup. */
export const notStartedChip = (): string => badge("idle", "not started");

/** Which states mean "still going". The list page's "Active" filter is
 *  built from this rather than the other way round: a state added to one
 *  and forgotten in the other is exactly the drift neither page can
 *  afford, and the single-job page needs the same test without importing
 *  the list's filter vocabulary. */
export const IN_FLIGHT: QueueRowView["state"][] = ["queued", "running"];

export const inFlight = (r: QueueRowView): boolean => IN_FLIGHT.includes(r.state);

/** The step a job is on, or — once it has stopped — the last one it
 *  reached. */
export function currentStep(r: QueueRowView): string {
  return r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
}

// The repo list said "waiting for archive" beside every unlanded
// branch, once per repo. Nobody asked for it: the State column already
// says what the spec is waiting for, so a two-repo row said the same
// thing three times, and the mark named a phase in a place that is
// otherwise about WHERE the work is. The list carries links now and
// nothing else. The flag it read cost an `isMerged` git call per repo
// per row, on every render, and went with it.

// --- spec 143: the one long message a row has to say -------------------------

/** A sentence a row has to show, and how loudly. The row draws it in a
 *  panel of its own (`specNoticeRow`, queue-list.ts) rather than in a
 *  table cell: both producers write free text out of a file or a
 *  runner's refusal — 130 characters on spec 141 — and every cell on
 *  this row is sized for a word. */
export interface RowNotice {
  variant: MessageVariant;
  text: string;
  /** The class the panel's message is marked with, for the one
   *  producer that has always carried one: a refusal (spec 151). */
  hook?: string;
}

/** Which of the three applies, if any. The order is the row's own: the
 *  queue's refusal of the press just made comes first, then a job that
 *  failed saying why it failed, and the spec's standing note about an
 *  archive that declined is what is left when no job is complaining.
 *
 *  The refusal is the third producer, added by spec 151 and the only
 *  one that belongs to no job: the queue returns it at enqueue time,
 *  before a job exists to carry it, so it reaches the page on the
 *  query string (`errorSpec`/`error`) instead. It was left drawing
 *  itself inside the name cell when spec 143 built this panel — where
 *  it pushed the branch marks and the title around, on the one row the
 *  reader had just pressed a button on. It outranks both of the
 *  others because it answers that press, and for the same reason it is
 *  said even while a job is running: a clash refusal is a refusal
 *  BECAUSE something is running, and gating it on "nothing in flight"
 *  would silence exactly the case it exists for.
 *
 *  Requirement 3 of 1-description.md — the panel cleared when a new
 *  action starts on the row — is already answered by each of them, in
 *  its own way, and neither needs a rule invented here:
 *
 *  `error` belongs to the job and is current by construction. The
 *  runner clears it the moment a step starts (`startOne`) and a freshly
 *  queued job is built without one, so a job that HAS one is parked,
 *  refused or stopped — and in every one of those the message is why
 *  the row is not moving. A job PARKED on an unmerged dependency is
 *  queued and holding its reason, which is why this is not gated on
 *  "nothing in flight": that gate would blank the one row whose whole
 *  point is to say why it is waiting.
 *
 *  The held-back note is the SPEC's and outlives any job, so it takes
 *  the gate `wordPhase` and `specStateChip` already keep: not while
 *  something is running, because a note from an earlier decline must
 *  not upstage the retry that may be clearing it. It needs no job at
 *  all, for the same reason `wordPhase` shows "held back" without an
 *  attempt — a spec archived by hand, or one whose archive job has
 *  aged out of the queue, still has its file saying why. */
export function specNotice(
  lead: QueueRowView | undefined,
  archiveHeldBack?: string,
  refusal?: string,
): RowNotice | undefined {
  if (refusal) return { variant: "err", text: refusal, hook: "refused" };
  if (lead?.error) return { variant: "err", text: lead.error };
  if (lead && inFlight(lead)) return undefined;
  // The same amber the badge takes, and for the same reason: a held-back
  // archive is a common, healthy outcome — notice, not alarm.
  if (archiveHeldBack) return { variant: "warn", text: `archive held back — ${archiveHeldBack}` };
  return undefined;
}

// --- spec 108: one rule for what a phase shows --------------------------------

/** What one phase reads as, in the three parts a row and a job page
 *  both need: the pip, the word in the badge, and — only when the last
 *  attempt disagrees with the file — a qualifier beneath it. */
export interface PhaseWord {
  pip: PipKind;
  /** Absent means "nothing has happened and nothing was attempted" —
   *  the row's "not run yet". */
  badge?: { variant: BadgeVariant; label: string };
  /** Said only when the last attempt disagrees with the truth above.
   *  Never repeats what the badge already says. */
  qualifier?: string;
}

/** The sentence for "these two records do not agree about this spec"
 *  (spec 154). Deliberately the same words the job-history version
 *  below uses — a reader has one thing to learn, and the file is the
 *  half that is wrong in both cases. */
const FILES_DISAGREE = "the files disagree with what has run";

/** The one rule, applied by everything that words a phase.
 *
 *  A row for spec 81 once said three things at once: pips and phase
 *  lines read the JOB HISTORY (a cancelled July re-run spoke for an
 *  analysis long since done and merged), the checkbox read the files
 *  unioned with that history, and archive read "done" off a job that
 *  had finished without moving anything.
 *
 *  So: `happened` — from the spec's own FILES — is what the phase IS.
 *  `heldBack` is archive's own answer to a question no exit status can
 *  give (see `archiveHeldBackReason`). The `attempt` is a qualifier
 *  layered on top, never the phase's state.
 *
 *  The last branch is worded exactly as the row always worded an
 *  attempt, with one exception: a job whose own state is `"done"` while
 *  the files say the phase has NOT happened would otherwise render the
 *  same badge as the first branch's real thing — the precise ambiguity
 *  this exists to remove. That one state goes in the qualifier instead;
 *  no other state's label collides with a file-truth badge. */
export function wordPhase(
  happened: boolean,
  heldBack: { reason: string } | undefined,
  attempt: QueueRowView | undefined,
  /** What the spec's own git history says about this phase, beyond
   *  whether it happened (spec 154). `stopped` is the reason the last
   *  run for this phase gave for not finishing; `fileDisagrees` is
   *  `4-status.md` claiming something the history does not show, or the
   *  reverse. */
  history: { stopped?: string; fileDisagrees?: boolean } = {},
): PhaseWord {
  const running = !!attempt && inFlight(attempt);
  const disagrees = !!attempt && !running && attempt.state !== "done";
  // Said when the file and the history part company, and never over a
  // qualifier that has something sharper to say: an attempt that ended
  // badly is the more useful sentence, and two lines of small print
  // under one badge is the row saying two things at once.
  const filesDisagree = history.fileDisagrees ? FILES_DISAGREE : undefined;
  if (happened) {
    return {
      pip: running ? "now" : "past",
      badge: { variant: "done", label: "done" },
      qualifier: disagrees ? `last re-run ${stateLabel(attempt!)}` : filesDisagree,
    };
  }
  // Not while something is running: a note from an earlier decline must
  // not upstage the retry that may be clearing it, and a pip reading
  // "now" beside a badge reading "held back" is the row saying two
  // things at once — the whole reason this function exists.
  if (heldBack && !running) {
    return {
      pip: "todo",
      // The sixth variant, not a seventh: "held back" is a common,
      // healthy outcome — notice, not alarm — which is the same reason
      // `stopped` takes this amber.
      badge: { variant: "waiting", label: "held back" },
      // Not the reason: it is a sentence, and the row's panel says it
      // once for the whole row (spec 143). Said here as well, it was
      // the same 130 characters twice on an open row — the duplication
      // 1-description.md reports.
      qualifier: disagrees ? `last re-run ${stateLabel(attempt!)}` : filesDisagree,
    };
  }
  // A step that RAN and did not finish, with nothing live left to say
  // so (spec 154). Spec 147's implement was killed by its own time
  // limit with RED and GREEN committed on the branch, and by the time
  // anyone read the row the queue's memory of that attempt was gone —
  // so the row said "not run yet" about work that was on disk. The
  // commit is what still knows, and it says why.
  //
  // Only without a live attempt: an attempt of its own has the fresher
  // answer and the badge below already words it.
  if (!attempt) {
    if (history.stopped) {
      return {
        // Amber, the same variant a stopped JOB takes (BADGE_VARIANT) —
        // notice, not alarm: the work is committed and the step can be
        // run again.
        pip: "todo",
        badge: { variant: "waiting", label: `stopped: ${history.stopped}` },
        qualifier: filesDisagree,
      };
    }
    return { pip: "todo", qualifier: filesDisagree };
  }
  if (attempt.state === "done") {
    return {
      pip: running ? "now" : "todo",
      qualifier: "last run reported done, but the files disagree",
    };
  }
  return {
    pip: running ? "now" : "todo",
    badge: { variant: BADGE_VARIANT[attempt.state], label: stateLabel(attempt) },
  };
}
