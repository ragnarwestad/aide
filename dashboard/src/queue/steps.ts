// The workflow's own vocabulary: which steps exist, which order they
// run in, and which states a job passes through — the piece every
// other file in this split reaches for first.

import type { Job } from "./types.ts";
import workflowStepsData from "../../../core/scripts/lib/workflow-steps.json" with { type: "json" };
import effortLevelsData from "../../../core/scripts/lib/effort-levels.json" with { type: "json" };

// `core/scripts/aide-run-spec` reads the same list from
// core/scripts/lib/workflow-steps.json (spec 349) — the shared file both
// sides import/read instead of declaring their own copy.
//
// `resolve` was here until spec 171 and is deliberately gone: a merge
// that fails is the merging step's problem, so `archive` resolves the
// conflict itself rather than a sixth phase standing beside the five.
//
// `reopen` joined it in spec 198: an archived spec whose work has to be
// done again is taken back into the active list by a step like any
// other, so that the dashboard's control and `/aide-reopen` in a
// terminal are one operation with one path. Queueable, but deliberately
// NOT part of the workflow arc (`HISTORY_STEPS`, `parse-status.ts`'s own
// list, the bash `WORKFLOW_ARC`) — it is not a stage a spec passes
// through. It DOES draw a phase box, unlike `explore` and `manifest`:
// since spec 271, `specPhases()` gives a completed `reopen` a fixed
// spot between `create` and `analyze`, where it happened.
//
// `schedule` joined it in spec 259: a project's own recurring job — a
// cron entry naming a prompt file in its repo, not an aide skill — runs
// through this same store, runner and render machinery. Its
// `specFolder` is a `schedule-<name>` tracking key that never resolves
// under the specs root, the same SHAPE `create`'s provisional key
// already has, though the exemption is separate new logic in
// `parseJobRequest` below rather than a copy of `create`'s (which lives
// in a wholly different parser, `parseCreateRequest`). Queueable and,
// like `explore`/`manifest`/`reopen`/`reset`, deliberately not part of
// the workflow arc: a schedule run is not a stage any spec passes
// through.

// TypeScript cannot infer a literal union from a JSON import (an array
// of strings types as `string[]`), and `WorkflowStep` is consumed as a
// literal union across thirteen other files — so this one type-level
// list is hand-written, and its only job is to exist for the type
// checker. The assertion below is what keeps it honest: importing this
// module throws the moment its members and workflow-steps.json's
// `workflowSteps` disagree, in every process that loads it (the
// dashboard and every test alike).
export type WorkflowStep =
  | "explore" | "create" | "analyze" | "implement" | "archive" | "manifest" | "reopen" | "reset"
  | "schedule";

const KNOWN_STEPS: readonly WorkflowStep[] = [
  "explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset",
  "schedule",
];

export const WORKFLOW_STEPS = workflowStepsData.workflowSteps as readonly WorkflowStep[];

if (
  WORKFLOW_STEPS.length !== KNOWN_STEPS.length ||
  !KNOWN_STEPS.every((s) => (WORKFLOW_STEPS as readonly string[]).includes(s))
) {
  throw new Error(
    `dashboard/src/queue/steps.ts's WorkflowStep union and ` +
      `core/scripts/lib/workflow-steps.json disagree: file has ` +
      `${JSON.stringify(WORKFLOW_STEPS)}, union has ${JSON.stringify(KNOWN_STEPS)}`,
  );
}

// The effort levels a step may be run at (spec 364), read the same way
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

/** Keep only jobs after the newest Reset that completed and landed. */
export function currentWorkRoundJobs<T extends {
  steps: readonly string[];
  state: string;
  landing?: boolean;
  createdAt: string;
  startedAt?: string;
}>(
  jobs: T[],
): T[] {
  const at = (job: T): number => Date.parse(job.startedAt ?? job.createdAt) || 0;
  const boundary = jobs
    .filter((job) => job.state === "done" && !job.landing && job.steps.includes("reset"))
    .reduce((latest, job) => Math.max(latest, at(job)), -Infinity);
  return boundary === -Infinity ? jobs : jobs.filter((job) => at(job) > boundary);
}

/** The steps a spec's row draws a box for, in the order they run — and
 *  so the steps a running job's tail may be given (spec 160). It is
 *  narrower than `WORKFLOW_STEPS` on purpose: `create` cannot be run
 *  for a spec that exists, `explore` is not a phase of the work, and
 *  `manifest` is not part of the workflow's order at all.
 *
 *  `queue-list.ts` keeps the same list, because the render layer does
 *  not import this module; the two are hand-paired and compared by
 *  `queue.test.ts`, exactly as `WORKFLOW_STEPS` is compared with the
 *  bash copy in `aide-run-spec`. */
export const PHASE_STEPS = ["analyze", "implement", "archive"] as const;

/** The two steps quick enough to jump a queued job ahead of a slower one
 *  (REQ-1): `create` and `archive` take minutes, `analyze` and
 *  `implement` a half hour or more. Every step not named here — `explore`,
 *  `manifest`, `reopen`, `reset`, `schedule` — stays in the slow group:
 *  none of them is characterized the way these four are, and REQ-1 names
 *  only these four. Module-internal: nothing outside this file needs it
 *  directly (only `queuePriorityOrder`, below, is exported for other
 *  files to call). */
const QUICK_STEPS: readonly WorkflowStep[] = ["create", "archive"];

/** The order a free slot is filled from (REQ-1), and the same order a
 *  queued row's position is read off (REQ-6): quick steps before slow
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
//
// The last two are `archive`'s own refusals: `aide-archive-spec` answered
// before any model ran — the spec has not implemented, or an acceptance
// row is unticked. Hand-paired with the `case` on `archive_terminal_reason`
// in `core/scripts/aide-run-spec`, which is what skips the model for
// exactly these; pinned by test/queue/parsing-schedule-and-errors.test.ts.
export const ARCHIVE_REFUSALS = ["not-implemented-yet", "acceptance-criteria-unticked"] as const;
export type ArchiveRefusal = (typeof ARCHIVE_REFUSALS)[number];
export function isArchiveRefusal(reason: unknown): reason is ArchiveRefusal {
  return (ARCHIVE_REFUSALS as readonly unknown[]).includes(reason);
}
export type StopReason = "budget" | "timeout" | "provider-limit" | "job-cap" | ArchiveRefusal;

/** States where a job still owns its work. Anything else has released
 *  it, and the same step may be queued again.
 *
 *  `awaiting-approval` was the third of them until spec 149. It was a
 *  stop between steps, waiting for a person to press Approve — and
 *  since every step lands its own work now, there is nothing left to
 *  hold a job for. */
export const UNFINISHED = new Set<string>(["queued", "running"]);

/** Every event that can move a job's state (spec 354), named for what
 *  actually triggers it rather than for the state it produces — two of
 *  these ("step-succeeded" and "step-succeeded-last") share a trigger
 *  the runner already distinguishes before it writes anything, so the
 *  table stays a pure function of (state, event). */
export type TransitionEvent =
  | "start" // queued -> running: tick, a slot is free
  | "no-step-left" // queued -> done: tick, nothing left to run
  | "cap-hit" // queued -> stopped: the next step would exceed the job cap
  | "cancel" // queued|running -> cancelled: a person pressed Cancel
  | "step-succeeded" // running -> queued: step ok, more steps left
  | "step-succeeded-last" // running -> done: step ok, last step
  | "step-failed" // running -> failed: the step reported failure
  | "run-stopped" // running -> stopped: budget, timeout or provider limit
  | "process-gone" // running -> interrupted: the process died with no result
  | "landing-failed"; // done -> failed: a landing did not finish

/** The one table every state change is checked against (spec 354). Each
 *  entry is `(from, event) -> to`; anything absent is refused. This is
 *  the machine `dashboard/docs/job-states.md`'s diagram draws by hand —
 *  `test/queue/transitions.test.ts` fails if the two ever disagree. */
export const TRANSITIONS: Readonly<Partial<Record<JobState, Partial<Record<TransitionEvent, JobState>>>>> = {
  queued: {
    start: "running",
    "no-step-left": "done",
    "cap-hit": "stopped",
    cancel: "cancelled",
  },
  running: {
    "step-succeeded": "queued",
    "step-succeeded-last": "done",
    "step-failed": "failed",
    "run-stopped": "stopped",
    "process-gone": "interrupted",
    cancel: "cancelled",
  },
  done: {
    // A landing that failed is not a spec that is done (spec 193). The
    // STEP succeeded, so `complete()` has already written `done`; only
    // from THAT state, because `complete()` may have queued the job's
    // next step before the landing settles, and a late landing failure
    // must not overwrite a job that has moved on — it is refused
    // instead, exactly as any other transition the table lacks an
    // entry for.
    "landing-failed": "failed",
  },
};

/** The one step an archived spec may be asked for (spec 198). A literal
 *  step name and never a denylist of the others: a list to be kept in
 *  step with `WORKFLOW_STEPS` is the drift this repo already names
 *  three times over. */
export const ARCHIVE_ONLY_STEP = "reopen";
