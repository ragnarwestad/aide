// One spec, however many jobs it took. The list is about SPECS. A spec
// taken through analyze, implement and archive as three separate jobs
// is still one spec, and how far it has got — and what its phases cost
// in time — should read without counting rows.

import { currentStep, inFlight, type QueueRowView } from "../../../ui/job-state.ts";
import { PHASE_LINES, QUEUE_STEPS, type Phase, type QueueTarget } from "./types.ts";

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

/** When a job most recently did anything, for sorting attempts newest
 *  first. Exported: `jobGroup` (`group-builders.ts`) sorts a spec's own
 *  jobs by the same recency to pick the one its header speaks for. */
export function activityMs(r: QueueRowView): number {
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
  const touched = new Set(all.flatMap(stepsTouched));
  const extra = [...touched].filter((s) => s !== "reopen" && !PHASE_LINES.includes(s));
  // A reopen is what STARTED this round: drawn between `create` and
  // `analyze`, where it happened, not appended after `archive` with
  // every other step outside the fixed four (spec 271).
  const analyzeIndex = PHASE_LINES.indexOf("analyze");
  const lines = touched.has("reopen")
    ? [...PHASE_LINES.slice(0, analyzeIndex), "reopen", ...PHASE_LINES.slice(analyzeIndex)]
    : PHASE_LINES;
  return [...lines, ...extra].map((step) => ({
    step,
    attempts: recent.map((r) => attemptFor(r, step)).filter((a): a is QueueRowView => a !== null),
    history: {},
  }));
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
