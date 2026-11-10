// The workflow's own vocabulary: which steps exist, which order they
// run in, and which states a job passes through — the piece every
// other file in this split reaches for first.

import type { Job } from "./types.ts";
import { RESULT_TOOLS, RUNNABLE_TOOLS, type ResultTool, type RunnableTool } from "./providers/tools.ts";
import { WORKFLOW_STEP_RECORDS, requireWorkflowStep, workflowControls } from "../workflow-steps.ts";
import effortLevelsData from "../../../core/scripts/lib/effort-levels.json" with { type: "json" };
import { inFlight } from "./job-rules/activity.ts";
export { inFlight, jobActivity, writing, type JobActivity } from "./job-rules/activity.ts";
import {
  ACCEPTANCE_CRITERIA_UNTICKED,
  isRunStop,
  type StopReason,
} from "../step-endings.ts";
import { isScheduleKey } from "../project/spec-names.ts";

export { ACCEPTANCE_CRITERIA_UNTICKED, isRunStop };
export type { StopReason };

// `core/scripts/aide-run-spec` reads the same list from
// core/scripts/lib/workflow-steps.json — the shared file both
// sides import/read instead of declaring their own copy.
//
// There is deliberately no `resolve` step: a merge
// that fails is the merging step's problem, so `archive` resolves the
// conflict itself rather than a sixth phase standing beside the five.
//
// `reopen` is a step too: an archived spec whose work has to be
// done again is taken back into the active list by a step like any
// other, so that the dashboard's control and `/aide-reopen` in a
// terminal are one operation with one path. Queueable, but deliberately
// NOT part of the workflow arc (`HISTORY_STEPS`, `parse-status.ts`'s own
// list, the bash `WORKFLOW_ARC`) — it is not a stage a spec passes
// through, and draws no phase line: `specPhases()` returns the four
// and the Logs tab lists the step.
//
// `schedule` is a step too: a project's own recurring job — a
// cron entry naming a prompt file in its repo, not an aide skill — runs
// through this same store, runner and render machinery. Its
// `specFolder` is a `schedule-<name>` tracking key that never resolves
// under the specs root, the same SHAPE `create`'s provisional key
// already has, though the exemption is separate new logic in
// `parseJobRequest` below rather than a copy of `create`'s (which lives
// in a wholly different parser, `parseCreateRequest`). Queueable and,
// like `explore`/`reopen`, deliberately not part of
// the workflow arc: a schedule run is not a stage any spec passes
// through.
//
// `deploy` is the board's own: Deploy on the project the board runs from is
// a job of its own, run by the server and finished by the process that
// starts after its restart (`serve/deploy-job/`). Its `specFolder` is the
// tracking key `deploy`, which no spec folder is.

// TypeScript cannot infer a literal union from a JSON import (an array
// of strings types as `string[]`), and `WorkflowStep` is consumed as a
// literal union across thirteen other files — so this one type-level
// list is hand-written, and its only job is to exist for the type
// checker. The assertion below is what keeps it honest: importing this
// module throws the moment its members and workflow-steps.json's
// `workflowSteps` disagree, in every process that loads it (the
// dashboard and every test alike).
export type WorkflowStep = string;

/** The steps the server runs itself, in its own process: the file the
 *  runner script reads does not name them, so `aide-run-spec --command`
 *  never takes one. They are queued, started and ended like any other
 *  step, but take no slot. */
export const BOARD_STEPS = WORKFLOW_STEP_RECORDS.filter((step) => step.runBy === "board").map((step) => step.name);
export const WORKFLOW_STEPS: readonly WorkflowStep[] = WORKFLOW_STEP_RECORDS.map((step) => step.name);

// The effort levels a step may be run at, read the same way
// WORKFLOW_STEPS is above — one shared file, a hand-written literal
// union for the type checker, and a runtime assertion that throws the
// moment the two disagree. `ultracode` is deliberately not a member
// (see core/scripts/lib/effort-levels.json's own comment).
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

const KNOWN_EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

export const EFFORT_LEVELS = effortLevelsData.effortLevels as readonly EffortLevel[];

if (
  EFFORT_LEVELS.length !== KNOWN_EFFORT_LEVELS.length ||
  !KNOWN_EFFORT_LEVELS.every((l) => (EFFORT_LEVELS as readonly string[]).includes(l))
) {
  throw new Error(
    `dashboard/src/queue/steps.ts's EffortLevel union and ` +
      `core/scripts/lib/effort-levels.json disagree: file has ` +
      `${JSON.stringify(EFFORT_LEVELS)}, union has ${JSON.stringify(KNOWN_EFFORT_LEVELS)}`,
  );
}

/** Keep only jobs after the newest round-discarding job that completed and
 *  landed: a reopen that reset the files. */
export function currentWorkRoundJobs<T extends {
  steps: readonly string[];
  state: string;
  landing?: boolean;
  resetFiles?: boolean;
  createdAt: string;
  startedAt?: string;
}>(
  jobs: T[],
): T[] {
  const at = (job: T): number => Date.parse(job.startedAt ?? job.createdAt) || 0;
  const discardsTheRound = (job: T): boolean =>
    job.steps.includes("reopen") && job.resetFiles === true;
  const boundary = jobs
    .filter((job) => job.state === "done" && !job.landing && discardsTheRound(job))
    .reduce((latest, job) => Math.max(latest, at(job)), -Infinity);
  return boundary === -Infinity ? jobs : jobs.filter((job) => at(job) > boundary);
}

/** The steps a spec's row draws a box for, in the order they run — and
 *  so the steps a running job's tail may be given. It is
 *  narrower than `WORKFLOW_STEPS` on purpose: `create` cannot be run
 *  for a spec that exists, `explore` is not a phase of the work.
 *
 *  `queue-list.ts` keeps the same list, because the render layer does
 *  not import this module; the two are hand-paired: change one and
 *  change the other. */
export const PHASE_STEPS = workflowControls().map((step) => step.name);

/** The steps quick enough to jump a queued job ahead of a slower one
 *  `create` and `archive` take minutes, `analyze` and
 *  `implement` a half hour or more. `close` does no model
 *  work either, in the same sense `archive` doesn't. Every step not
 *  named here — `explore`, `reopen`, `schedule` —
 *  stays in the slow group: none of them is characterized the way these
 *  are. Module-internal: nothing outside this file needs it directly
 *  (only `queuePriorityOrder`, below, is exported for other files to
 *  call). */
const QUICK_STEPS: readonly WorkflowStep[] = ["create", "archive", "close"];

/** The order a free slot is filled from, and the same order a
 *  queued row's position is read off: quick steps before slow
 *  ones, oldest first within each group. A STABLE sort — handed an
 *  already oldest-first list, it only ever reorders across the quick/
 *  slow boundary, never within a group. */
export function queuePriorityOrder<T extends { steps: readonly WorkflowStep[]; stepIndex: number }>(
  oldestFirst: readonly T[],
): T[] {
  const rank = (job: T): number => (QUICK_STEPS.includes(job.steps[job.stepIndex]) ? 0 : 1);
  return [...oldestFirst].sort((a, b) => rank(a) - rank(b));
}

/** Which steps a reader may still tick or untick on a job, in workflow
 *  order — the tail that has not started, plus every phase the job does
 *  not have that would run AFTER the one running now.
 *
 *  One function for two callers: the store refuses anything it does not
 *  name, and `serve.ts` puts it on the row so a box is never drawn live
 *  for an edit the store would refuse. Nothing but a RUNNING job has an
 *  editable tail — a job between two steps is a job whose next step may
 *  start in the same instant, and the window is under two seconds. */
export function tailEdits(job: Pick<Job, "steps" | "stepIndex" | "state">): string[] {
  if (job.state !== "running") return [];
  const current = job.steps[job.stepIndex];
  if (current === undefined) return [];
  const rank = WORKFLOW_STEPS.indexOf(current as WorkflowStep);
  const tail = new Set(job.steps.slice(job.stepIndex + 1));
  return PHASE_STEPS.filter(
    (s) => tail.has(s) || (!job.steps.includes(s) && WORKFLOW_STEPS.indexOf(s) > rank),
  );
}

export const JOB_STATES = [
  "queued", "running", "done",
  "stopped", "failed", "cancelled", "interrupted",
] as const;
export type JobState = (typeof JOB_STATES)[number];

// Why a run ended early. `stopped` is deliberately not `failed`: with
// tight caps a cap-stop is a common, healthy outcome, and a reader who
// cannot tell it from a broken agent will start ignoring both.
// `tests-red` is here for the same reason: the landing ran the project's
// own suite on the merged result and it went red, so nothing was pushed.
// The step did its work and the machinery did its job — the code is not
// green yet, and the answer is to run implement again.
// `acceptance-criteria` is an analyze the runner stopped at the spec's
// `criteriaChecks: stop`: the description needs putting right first.
// `shared-files` is an analyze the runner stopped because another open
// spec's analysis lists the same files: the two specs must be ordered first.
// `model-at-capacity` is a step the provider had no room for: unlike a
// usage limit it has no reset to wait for, and another model runs at once.
// `sent-back` is an implement that found its spec, analysed short, not small
// after all: the board queues a full analysis and implement again.
/** The states in which a job waits for a person. `cancelled` is not one:
 *  a person ended it themselves. */
export const WAITS_FOR_PERSON = new Set<JobState>(["failed", "stopped", "interrupted"]);

/** How the result of an archive held back on unticked acceptance criteria ends. */
/** Whether a finished job waits for a person: it failed, stopped or was
 *  interrupted (a conflict is a failure), or it is an archive held back on
 *  unticked acceptance criteria. */
export const waitsForPerson = (
  job: { state: string; results?: readonly { terminalReason?: string }[] },
): boolean =>
  WAITS_FOR_PERSON.has(job.state as JobState) ||
  (job.state === "done" && job.results?.at(-1)?.terminalReason === ACCEPTANCE_CRITERIA_UNTICKED);

/** States where a job still owns its work. Anything else has released
 *  it, and the same step may be queued again.
 *
 *  There is no `awaiting-approval` state: every step lands its own
 *  work, so there is nothing between steps to hold a job for. */
export const UNFINISHED = new Set<string>(["queued", "running"]);

/** Every event that can move a job's state, named for what
 *  actually triggers it rather than for the state it produces — two of
 *  these ("step-succeeded" and "step-succeeded-last") share a trigger
 *  the runner already distinguishes before it writes anything, so the
 *  table stays a pure function of (state, event). */
export type TransitionEvent =
  | "start" // queued -> running: tick, a slot is free
  | "no-step-left" // queued -> done: tick, nothing left to run
  | "cancel" // queued|running -> cancelled: a person pressed Cancel
  | "step-succeeded" // running -> queued: step ok, more steps left
  | "step-succeeded-last" // running -> done: step ok, last step
  | "step-failed" // running -> failed: the step reported failure
  | "run-stopped" // running -> stopped: timeout or provider limit
  | "process-gone" // running -> interrupted: the process died with no result
  | "retry" // running -> queued: one eligible automatic second attempt
  | "retry-late" // stopped|done -> queued: a post-run check spends the same allowance
  | "landing-failed" // done -> failed: a landing did not finish
  | "landing-held" // done -> stopped: the landing's suite went red
  | "landing-cancelled" // done -> cancelled: Cancel pressed while it merged
  | "limit-reset"; // stopped -> queued: its provider's usage limit has reset

/** The one table every state change is checked against. Each
 *  entry is `(from, event) -> to`; anything absent is refused. This is
 *  the machine `dashboard/docs/job-states.md`'s diagram draws by hand —
 *  `test/queue/transitions.test.ts` fails if the two ever disagree. */
export const TRANSITIONS: Readonly<Partial<Record<JobState, Partial<Record<TransitionEvent, JobState>>>>> = {
  queued: {
    start: "running",
    "no-step-left": "done",
    cancel: "cancelled",
  },
  running: {
    "step-succeeded": "queued",
    "step-succeeded-last": "done",
    "step-failed": "failed",
    "run-stopped": "stopped",
    "process-gone": "interrupted",
    retry: "queued",
    cancel: "cancelled",
  },
  done: {
    "retry-late": "queued",
    // A landing that failed is not a spec that is done. The
    // STEP succeeded, so `complete()` has already written `done`; only
    // from THAT state, because `complete()` may have queued the job's
    // next step before the landing settles, and a late landing failure
    // must not overwrite a job that has moved on — it is refused
    // instead, exactly as any other transition the table lacks an
    // entry for.
    "landing-failed": "failed",
    // The one landing failure that is not a fault: the project's own
    // suite went red on the merged result, so nothing was pushed. Same
    // state a cap-stop takes, and for the same reason — a reader who
    // cannot tell "not green yet" from a broken agent ignores both.
    "landing-held": "stopped",
    // Cancel pressed while the finished step's work was being merged and
    // tested: nothing was pushed, and the job says a person ended it.
    "landing-cancelled": "cancelled",
  },
  // The one way out of `stopped`: a step its provider's usage limit stopped
  // is queued again by the board once the limit has reset
  // (`restartAfterUsageLimit`). Every other stop waits for a person.
  stopped: {
    "retry-late": "queued",
    "limit-reset": "queued",
  },
};

/** The one step an archived spec may be asked for. A literal
 *  step name and never a denylist of the others: a list to be kept in
 *  step with `WORKFLOW_STEPS` is the drift this repo already names
 *  three times over. */
export const ARCHIVE_ONLY_STEP = "reopen";

export { RUNNABLE_TOOLS, type RunnableTool };

/** A tool name off a file, or undefined when it is not one of ours. */
export function asRunnableTool(value: unknown): RunnableTool | undefined {
  return typeof value === "string" && (RUNNABLE_TOOLS as readonly string[]).includes(value)
    ? (value as RunnableTool)
    : undefined;
}

/** The same, widened by the one value a result file carries that is not
 *  a CLI at all: `none` is the deterministic `create` path. */
export function asResultTool(value: unknown): ResultTool | undefined {
  return (RESULT_TOOLS as readonly unknown[]).includes(value) ? (value as ResultTool) : undefined;
}

/** Whether a landing is under way in `project`. A landing moves that
 *  project's own checkouts and no other's, so Reset, Close and a test
 *  server wait for this one — never for a landing somewhere else on the
 *  board. */
export function landingInProject(jobs: Job[], project: string): boolean {
  return jobs.some((job) => job.landing && job.project === project);
}

/** The step a job is on when it is a Close or a Reopen: the Running page
 *  draws such a job as a row of its own, never as its spec's. A reopen
 *  that has gone on to the spec's next step is the spec's again. */
/** The tracking key of a deploy job: no spec folder is called this. */
export const DEPLOY_KEY = "deploy";

/** The tracking key of the board's host-process cleanup job. */
export const CLEANUP_KEY = "cleanup";

/** The step a job is on when it is a deploy: the Running page draws such a
 *  job as a row of its own, never as a spec's. */
export type JobKind = "spec" | "schedule" | "deploy" | "cleanup" | "close" | "reopen";

export function jobKind(job: { steps: readonly string[]; stepIndex: number; specFolder: string }): JobKind {
  const step = job.steps[job.stepIndex ?? 0];
  if (step === "deploy" || step === "cleanup" || step === "close" || step === "reopen") return step;
  return step === "schedule" && isScheduleKey(job.specFolder) ? "schedule" : "spec";
}

export const jobDismissible = (job: {
  steps: readonly string[]; stepIndex: number; specFolder: string; state: string; landing?: boolean;
  results?: readonly { terminalReason?: string }[];
}): boolean => jobKind(job) === "schedule" && !inFlight(job) && waitsForPerson(job);

/** The steps that hold none of the runner's slots. A board step runs in the
 *  server's own process. A create takes about a minute and is what gives a
 *  spec its number and its row, so it is never left behind an analyze or an
 *  implement. Every other step takes a slot. */
/** Whether the job's CURRENT step holds one of the runner's slots. A step
 *  that takes none neither counts against `maxConcurrent` nor waits for it;
 *  the same job's next step is asked again when it starts. */
export const takesSlot = (job: { steps: readonly string[]; stepIndex: number }): boolean =>
  requireWorkflowStep(job.steps[job.stepIndex] ?? "").takesSlot;
