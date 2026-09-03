// What a queued job looks like to a page. Both the list and the
// single-job page need this, and neither owns it.

import type { TddPhase } from "../../../queue/aide-run-store.ts";

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
  /** Where a queued job stands among every job waiting its turn (REQ-4):
   *  `n` is its 1-indexed place in `queuePriorityOrder()`'s order
   *  (REQ-1), `total` the number of jobs `queued` right now. Computed by
   *  `jobRow()` off the SAME function `Runner.tick()` calls (REQ-6), so
   *  the two cannot disagree. Absent for every state but `queued`. */
  queuePosition?: { n: number; total: number };
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
  stopReason?: "budget" | "timeout" | "provider-limit" | "job-cap" | "not-implemented-yet" | "acceptance-criteria-unticked";
  /** The pull request a `pr`-mode run opened for this job's code branch
   *  (spec 220). Stored on the job rather than derived at render time —
   *  only the run that called `gh` knows the URL, and there is nothing
   *  on this machine to re-derive it from. */
  prUrl?: string;
  /** Why `gh` opened none. Shown BESIDE the branch rather than as the
   *  job's error, because the step succeeded and the code really is on
   *  its branch — what is missing is the request describing it, which
   *  for a project whose landing deliberately leaves that branch open is
   *  the whole difference between waiting on a review and an orphan. */
  prError?: string;
  /** Why the branch itself did not reach origin (spec 328). Shown beside
   *  the branch like `prError`, and for the same reason: the step
   *  succeeded and its work is committed, only the push failed. */
  pushError?: string;
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
  errorReason?: "conflict" | "unlanded" | "tests-red";
  /** The job's own persisted landing failure (spec 327), independent of
   *  `state`/`error` — see `Job.landingError`. */
  landingError?: string;
  /** Raw git/tool output behind `error` (spec 352, REQ-5) — see
   *  `Job.errorDetail`. */
  errorDetail?: string;
  /** What this job ran on. Shown next to the cost, because a figure
   *  without its model cannot be compared with the next one. */
  model?: string;
  /** The effort level this step ran at, when one was chosen (spec 364).
   *  Absent means none was — a real, valid resting state, unlike
   *  `model`, which a job always carries a real value for. */
  effort?: string;
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
