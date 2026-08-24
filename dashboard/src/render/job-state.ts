// What a queued job looks like to a page, and how its state is put into
// words. Both the list and the single-job page need this, and neither
// owns it.

import { badge, stepLabel, type BadgeVariant, type MessageVariant, type PipKind } from "./components.ts";
import { TDD_PHASES, type TddPhase } from "../aide-run-store.ts";

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
  landing?: boolean;
  spentUsd: number;
  /** The same figure in tokens (spec 118). A NUMBER here, not the stored
   *  split: the page shows a compact total and nothing else, and the
   *  render layer has no business knowing the shape of a result file.
   *  Absent means nothing measured it — the cell shows a dash. */
  spentTokens?: number;
  timeoutSec: number;
  createdAt: string;
  startedAt?: string;
  stopReason?: "budget" | "timeout" | "provider-limit";
  /** Every repo this job pushed to, one entry each — a list even when it
   *  holds one, because `paceup` and `atlasaurus` (specs inside the
   *  project repo, one branch per job) are the NORMAL shape and must
   *  render through the same code as a two-repo job, not a fork of it.
   *  Derived live from git at render time, never stored on the job: the
   *  answer changes long after the job stops running. */
  branchUrls?: BranchView[];
  /** The pull request a `pr`-mode run opened for this job's code branch
   *  (spec 220). Stored on the job rather than derived at render time,
   *  unlike `branchUrls`: only the run that called `gh` knows the URL,
   *  and there is nothing on this machine to re-derive it from. */
  prUrl?: string;
  /** Why `gh` opened none. Shown BESIDE the branch rather than as the
   *  job's error, because the step succeeded and the code really is on
   *  its branch — what is missing is the request describing it, which
   *  for a project whose landing deliberately leaves that branch open is
   *  the whole difference between waiting on a review and an orphan. */
  prError?: string;
  error?: string;
  /** Why the job's own landing was refused, when it was refused for
   *  something the row can offer a way out of. Stored on the job since
   *  spec 149 and read from here: a landing happens with nobody's
   *  browser attached, so the reason cannot ride in a redirect the way
   *  the Merge button's refusal used to.
   *
   *  Hand-paired with the same union on `Job` in `queue.ts` — the two
   *  layers deliberately do not import each other, so `queue.test.ts`
   *  reads both declarations and asserts they name the same members. */
  errorReason?: "conflict" | "unlanded";
  /** What this job ran on. Shown next to the cost, because a figure
   *  without its model cannot be compared with the next one. */
  model?: string;
  /** Which third of an `implement` step is running RIGHT NOW (spec
   *  210), from the report `/aide-implement` sends at each TDD
   *  boundary. Set by the server only for a running implement whose
   *  session the store has an answer for — every other row leaves it
   *  absent and reads exactly as it did before. Absent is the ordinary
   *  case, not an error: a run whose reports never arrived says
   *  "running" and fills nothing. */
  tddPhase?: TddPhase;
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
  /** When this step ENDED (spec 199). It is the only per-step instant
   *  there is: a job carries one `startedAt` however many steps it ran,
   *  so a step's own span is sliced between this and the previous
   *  step's end. Absent on a result written before the runner recorded
   *  it, and then that step simply has no duration to show. */
  at?: string;
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
    if (r.stopReason === "timeout") return `stopped — ${Math.round(r.timeoutSec / 60)} min`;
    return r.stopReason === "provider-limit" ? "stopped — provider limit" : "stopped — budget";
  }
  return r.state;
}

/** How long, in words (spec 199). "45s", "4m12s", "1h04m" — the unit
 *  above the one being read is always there, so two figures beside each
 *  other compare without anyone counting digits.
 *
 *  Seconds are dropped past the hour on purpose: a step that ran for
 *  two hours is not a figure anybody reads to the second, and the
 *  column it sits in is the narrowest on the page.
 *
 *  HAND-PAIRED with `formatElapsed` in `src/queue-client.ts`, which
 *  rewrites a running phase's mark once a second and cannot import this
 *  one (the client file is transpiled into an inline <script>). The two
 *  are pinned by `test/queue-client.test.ts`, "the page words a
 *  duration exactly as the server does". Change one and change the
 *  other, or a phase changes its wording the first time the clock
 *  ticks over the figure the server drew. */
export function durationLabel(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  if (secs < 3600) return `${Math.floor(secs / 60)}m${pad(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h${pad(Math.floor((secs % 3600) / 60))}m`;
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
// One word each since 2026-08-24 ("ready", "done"): the phase the spec
// is ready FOR is already named by the Run button beside this badge —
// the same `readyPhase` names both, so they cannot disagree — and
// "nothing waiting on you" said nothing "done" does not. The colour
// still tells the two apart at a glance.
export function restingChip(resting: RestingState = {}): string {
  if (resting.archiveHeldBack) return badge("waiting", "archive held back");
  if (resting.readyPhase) return badge("ready", "ready");
  return badge("done", "done");
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

/** Which of the four applies, if any. The order is the row's own: the
 *  queue's refusal of the press just made comes first, then a job that
 *  failed saying why it failed, then the spec's standing note about an
 *  archive that declined, and last a phase whose own record disagrees
 *  with the files.
 *
 *  That fourth one is the newest (spec 195) and ranks lowest because it
 *  is the least specific: a refusal answers a button the reader just
 *  pressed, an error says why the row is not moving, and a held-back
 *  note names a decision — a disagreement is a standing condition that
 *  was true before any of them and will still be true after. It reaches
 *  this function already worded with its phase's name (`analyze: …`),
 *  because it used to be drawn beneath that phase's own badge and a
 *  sentence moved out of the line it belonged to must say which line
 *  that was. `phaseWordCell` drew it in a `<div>` of its own until spec
 *  195, which made a phase line with something to say taller than the
 *  ones beside it — the same symptom, and the same cause, spec 176
 *  fixed for the stale mark and the tries count.
 *
 *  `archiveHeldBack` and the disagreement are the one PAIR that can
 *  both be true of the same phase: archive is held back and its own
 *  last re-run failed. First-match-wins would drop one of two true
 *  things silently, so that pair is joined into one message instead.
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
  /** A phase's own qualifier, worded with that phase's name by the
   *  caller — this file knows nothing about a spec's phase list. */
  disagreement?: string,
): RowNotice | undefined {
  if (refusal) return { variant: "err", text: refusal, hook: "refused" };
  if (lead?.error) return { variant: "err", text: lead.error };
  if (lead && inFlight(lead)) return undefined;
  // The same amber the badge takes, and for the same reason: a held-back
  // archive is a common, healthy outcome — notice, not alarm. A
  // disagreement takes the same amber for the same reason.
  if (archiveHeldBack && disagreement) {
    // Both true at once, and both said. The prefix below already names
    // archive, and a disagreement competing with a held-back note is
    // archive's own by construction — so the phase name it arrived with
    // comes off rather than being written twice in one sentence.
    const detail = disagreement.replace(/^archive: /, "");
    return { variant: "warn", text: `archive held back — ${archiveHeldBack} · ${detail}` };
  }
  if (archiveHeldBack) return { variant: "warn", text: `archive held back — ${archiveHeldBack}` };
  if (disagreement) return { variant: "warn", text: disagreement };
  return undefined;
}

/** How many of a running implement's three parts are BEHIND it (spec
 *  210) — what the pip fills in, as `pips()` wants it. Answered about
 *  the ROW, so the "only while it is actually running" half of the rule
 *  is written once rather than at each of the two call sites.
 *
 *  Off by one from the phase's own position, and deliberately: `red` is
 *  the first third being worked on, not the first third finished. A pip
 *  that looked a third done five seconds into RED would misinform about
 *  how far the run has got, which is worse than saying nothing — so
 *  `red` and "no report at all" render identically.
 *
 *  One function, because both places the answer appears — the spec
 *  list's pip strip and the job page's — would otherwise each carry the
 *  same guarded `indexOf`, and a transposition in one of them is a
 *  silent lie about progress. */
export function completedThirds(attempt: QueueRowView | undefined): 1 | 2 | undefined {
  // The state itself, never `inFlight`: that is queued OR running, and a
  // job waiting to start is in no TDD phase at all.
  if (!attempt || attempt.state !== "running") return undefined;
  const tddPhase = attempt.tddPhase;
  if (!tddPhase) return undefined;
  const behind = TDD_PHASES.indexOf(tddPhase);
  return behind === 1 || behind === 2 ? behind : undefined;
}

// --- spec 108: one rule for what a phase shows --------------------------------

/** What one phase reads as, in the three parts a row and a job page
 *  both need: the pip, the word in the badge, and — only when the last
 *  attempt disagrees with the file — a qualifier. */
export interface PhaseWord {
  pip: PipKind;
  /** Absent means "nothing has happened and nothing was attempted" —
   *  the row's "not run yet". */
  badge?: { variant: BadgeVariant; label: string };
  /** Said only when the last attempt disagrees with the truth above.
   *  Never repeats what the badge already says.
   *
   *  A sentence, not a word — so the phase LINE never draws it. The
   *  caller hands it to the row's panel instead, named for its phase
   *  (`specNotice`, spec 195); on the queue list a phase line is the
   *  badge and nothing else, whatever has happened to that phase. */
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
  // badly is the more useful sentence, and two sentences about one
  // phase is the row saying two things at once.
  const filesDisagree = history.fileDisagrees ? FILES_DISAGREE : undefined;
  // A phase that is running says so, whatever happened the last time it
  // ran. The history's "done" is about a previous attempt; this one is
  // in flight, and a line reading "done · 2 attempts" over a spec the
  // State column says is archiving is the row saying two things at once
  // (reported 2026-08-23). Only the pip moved before, and a pip is not
  // a word.
  if (running) {
    return {
      pip: "now",
      badge: {
        variant: BADGE_VARIANT[attempt!.state],
        // Which third of an implement is running, in the word as well as
        // on the pip (spec 210): "running" for an hour says nothing, and
        // the State column reserves its width already, so the longer
        // word moves nothing outside it. Only implement reports phases,
        // so only implement's rows are given one (`jobRow`, serve.ts).
        //
        // The state, not `running` above: that flag is `inFlight`, which
        // is queued OR running, and a job WAITING to start is in no TDD
        // phase at all. "queued (refactor)" would be the row reading a
        // leftover report as if it were live.
        label:
          attempt!.tddPhase && attempt!.state === "running"
            ? `${stateLabel(attempt!)} (${attempt!.tddPhase})`
            : stateLabel(attempt!),
      },
      qualifier: filesDisagree,
    };
  }
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
