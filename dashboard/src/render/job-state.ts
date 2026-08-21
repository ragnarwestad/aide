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
  /** Whether THAT repo's branch has landed on THAT repo's default
   *  branch. One flag per repo: a spec whose project branch merged and
   *  whose specs branch did not is the case this exists for. */
  merged: boolean;
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
 *  the SPEC's answer (see `nextActionHint`).
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
 *  sat one line lower. The order of the resting cases is
 *  `nextActionHint`'s own, unchanged: a branch to merge outranks a
 *  phase to run, and a held-back archive outranks both. */
export function specStateChip(r: QueueRowView, resting: RestingState = {}): string {
  if (r.state === "running") return badge("running", gerund(currentStep(r)));
  if (r.state === "queued") return badge("idle", `${gerund(currentStep(r))} queued`);
  if (r.state === "done") {
    // The WORD only. The reason is a sentence out of `4-status.md` —
    // 130 characters on spec 141 — and a badge is `nowrap`, so it ran
    // off the right edge of the table. It is said in full in the row's
    // own panel instead (`specNotice`), once (spec 143).
    if (resting.archiveHeldBack) return badge("waiting", "archive held back");
    if (resting.readyPhase) return badge("ready", `ready for ${resting.readyPhase}`);
    return badge("done", "done — nothing waiting on you");
  }
  return stateChip(r);
}

/** "analyze" → "analyzing", "review" → "reviewing" — from the reader's
 *  word (`stepLabel`), so `review-plan` gerunds as "reviewing". */
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

/** What this job is doing, in words: the step and the state together,
 *  e.g. `review-plan running`. Both pages ask this one function, for the
 *  same reason `stateLabel` exists — a spec's state and a phase's state
 *  are the same question at two altitudes and must never be worded
 *  differently. */
export function activityLabel(r: QueueRowView): string {
  return `${stepLabel(currentStep(r))} ${stateLabel(r)}`;
}

// A branch link says where the work IS, never whether it landed, so a
// finished job reads as a delivered one. The caveat sits beside the link
// on both pages, and disappears the moment the branch is an ancestor of
// the default branch — which is the whole point of asking git live.
// Anything unproven keeps the caveat: uncertainty must not read as done.
//
// Per REPO, not per job: one badge over two repos cannot say that the
// project's branch landed and the specs repo's did not, and that is
// exactly the state that went unnoticed three times on 2026-08-17.
//
// It used to say "not merged" whatever the job was doing — a fact about
// the BRANCH, read as a verdict on the spec. Beside a step that was
// still writing to that branch it said nothing about the one thing that
// decided whether the branch mattered, so the badge is handed the job's
// activity and says that instead.
//
// What is left once there is no activity to report used to be "ready to
// merge", which was an instruction: press the button. Spec 149 removed
// the button — every step lands its own work — so the one window a
// branch can legitimately sit open in is after `implement` and before
// `archive`, and the badge states that rather than asking for anything.
export function unmergedBadge(b: BranchView, activity?: string): string {
  if (b.merged) return "";
  if (activity) return ` ${badge("running", activity)}`;
  return ` ${badge("ready", "waiting for archive")}`;
}

/** The badge's second argument, worked out from the job that owns the
 *  branch — written once so the two pages cannot drift on when a job
 *  counts as busy any more than on what to call it. */
export const branchActivity = (r: QueueRowView): string | undefined =>
  inFlight(r) ? activityLabel(r) : undefined;

/** The line UNDER the badge, for the states whose badge cannot carry
 *  the whole answer: never run, waiting on a person, or stopped short.
 *  Everything else on the row answers a narrower question — the pips
 *  say what has run, the chip says the state, the badges say what is
 *  unmerged — and a reader had to assemble the answer from all of them.
 *
 *  Spec 132: a resting `done` says nothing here any more. Its four
 *  sub-cases are what the badge itself now reads (`specStateChip`), the
 *  same way an in-flight row has said its verb in the badge and nothing
 *  below it since spec 101 — saying it in both places is the row
 *  telling a reader one fact at two levels of precision.
 *
 *  That move took two of this function's arguments with it. The spec's
 *  open branch (spec 96) and the earliest phase its own FILES say has
 *  not happened (spec 111) were read HERE only to word the `done`
 *  sentence; the caller works both out exactly as before and hands them
 *  to `specStateChip` instead. Spec 143 took the third — the held-back
 *  archive — to the row's panel (`specNotice`) for the same reason it
 *  took it out of the badge: it is a sentence, and every cell on this
 *  row is sized for a word. Nothing free-text is left here.
 *
 *  Built from `stepLabel`/`currentStep` rather than from new literals,
 *  for the same reason those exist: the same job must not be worded one
 *  way in the chip and another way here. It says nothing the row does
 *  not already contain — it says it in one place, as a sentence. */
export function nextActionHint(r: QueueRowView | undefined): string {
  if (!r) return "never run — tick a phase and press Run";
  // In flight the sentence says NOTHING (asked for 2026-08-19): the
  // spec's chip already reads "analyzing" (`specStateChip`) and the
  // running phase line says the rest — "analyze running — review to
  // follow" was the same fact a third time.
  if (r.state === "queued" || r.state === "running") return "";
  // Spec 132 said the file's reason here for the four states BELOW —
  // failed, stopped, cancelled, interrupted — because the badge that
  // reads "failed" has no room for it. Spec 143 moved it to the row's
  // own panel (`specNotice`), which has the width for a sentence and
  // draws it for every state: the State column is a cell sized for a
  // word, and putting the sentence back here would only reinstate the
  // overflow one state further along. What is left is the same thing
  // the other stopped-short rows say — what to press.
  //
  // A resting `done` says the whole of it in the badge
  // (`specStateChip`): the branch waiting, the phase that is ready, or
  // that nothing is waiting on anyone.
  if (r.state === "done") return "";
  // failed, stopped, cancelled, interrupted: the chip beside this line
  // already says which of the four it was, and the row's own error text
  // says why. What is missing is what to do about it.
  return `press Run to try ${stepLabel(currentStep(r))} again`;
}

// --- spec 143: the one long message a row has to say -------------------------

/** A sentence a row has to show, and how loudly. The row draws it in a
 *  panel of its own (`specNoticeRow`, queue-list.ts) rather than in a
 *  table cell: both producers write free text out of a file or a
 *  runner's refusal — 130 characters on spec 141 — and every cell on
 *  this row is sized for a word. */
export interface RowNotice {
  variant: MessageVariant;
  text: string;
}

/** Which of the two applies, if either. The order is the row's own: a
 *  job that failed says why it failed, and the spec's standing note
 *  about an archive that declined is what is left when no job is
 *  complaining.
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
): RowNotice | undefined {
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
): PhaseWord {
  const running = !!attempt && inFlight(attempt);
  const disagrees = !!attempt && !running && attempt.state !== "done";
  if (happened) {
    return {
      pip: running ? "now" : "past",
      badge: { variant: "done", label: "done" },
      qualifier: disagrees ? `last re-run ${stateLabel(attempt!)}` : undefined,
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
      qualifier: disagrees ? `last re-run ${stateLabel(attempt!)}` : undefined,
    };
  }
  if (!attempt) return { pip: "todo" };
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
