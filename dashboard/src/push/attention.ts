// Who needs a person, decided from two things a job holds: its state and
// how many step results it has. Compared with what the observer saw last
// time, that is enough to tell "just entered a waiting state" from "was
// already there and has been updated again" — see `index.ts` for the
// snapshot itself.

import type { MessageKey } from "../i18n/messages.ts";
import { createEndedWithoutSpec } from "../queue/create-failure.ts";
import type { Job } from "../queue/queue.ts";
import type { ScheduleNotify } from "../queue/schedule.ts";
import type { JobState, StopReason } from "../queue/steps.ts";
import { isSpecFolder } from "../render/ui/shell.ts";

/** What the observer remembers of a job between two changes. */
export interface Seen {
  state: JobState;
  results: number;
  /** Whether it was a create that had ended without a spec. */
  createFailed?: boolean;
}

export const seenOf = (job: Job): Seen => ({
  state: job.state,
  results: job.results.length,
  createFailed: createEndedWithoutSpec(job),
});

export interface Attention {
  kind: "failed" | "stopped" | "interrupted" | "archive-held-back" | "create-failed" | "schedule-run";
  step: string;
  reason?: StopReason;
  /** How a scheduled run ended, for `schedule-run`. */
  outcome?: ScheduleOutcome;
}

export type ScheduleOutcome = "done" | "failed" | "stopped" | "interrupted";

/** The entry's choice for a scheduled job, read only when asked; null
 *  when the entry is gone. */
export type ScheduleChoice = () => ScheduleNotify | null;

/** The same test `parse-request.ts` applies: one step, `schedule`, under
 *  a `schedule-` key. */
const isScheduleJob = (job: Job): boolean =>
  job.steps.length === 1 && job.steps[0] === "schedule" && job.specFolder.startsWith("schedule-");

const SCHEDULE_OUTCOMES = new Set<JobState>(["done", "failed", "stopped", "interrupted"]);

/** One notification when a scheduled run ENDS (the edge into a final
 *  state), by the entry's own choice. `cancelled` is a person's own act
 *  and has no outcome here. */
function scheduleRunAttention(prev: Seen | undefined, job: Job, choice?: ScheduleChoice): Attention | null {
  if (!SCHEDULE_OUTCOMES.has(job.state) || job.state === prev?.state) return null;
  const wanted = choice?.();
  if (!wanted || wanted === "never") return null;
  if (wanted === "failure" && job.state === "done") return null;
  return { kind: "schedule-run", step: "schedule", outcome: job.state as ScheduleOutcome };
}

/** The states in which a job waits for a person. `cancelled` is not one:
 *  a person ended it themselves. */
const WAITING = new Set<JobState>(["failed", "stopped", "interrupted"]);

export function attentionFor(prev: Seen | undefined, job: Job, scheduleChoice?: ScheduleChoice): Attention | null {
  // A create that ended without a spec names its project and title and
  // opens New spec, once: the edge of the rule, not the state, is the trigger.
  if (createEndedWithoutSpec(job)) return prev?.createFailed ? null : { kind: "create-failed", step: "create" };
  if (isScheduleJob(job)) return scheduleRunAttention(prev, job, scheduleChoice);
  // A create still under way has no spec to name and none to open.
  if (!isSpecFolder(job.specFolder)) return null;
  const last = job.results.at(-1);
  if (job.state !== prev?.state && WAITING.has(job.state)) {
    // An interrupted step left no result of its own, so the step that
    // was in flight is the one at `stepIndex`; the others ended with one.
    const step = job.state === "interrupted" ? job.steps[job.stepIndex] : (last?.step ?? job.steps[job.stepIndex]);
    return { kind: job.state as "failed" | "stopped" | "interrupted", step: step ?? "implement", reason: job.stopReason };
  }
  if (
    job.state === "done" &&
    job.results.length > (prev?.results ?? 0) &&
    last?.terminalReason === "acceptance-criteria-unticked"
  ) {
    return { kind: "archive-held-back", step: "archive" };
  }
  return null;
}

const SCHEDULE_KEYS: Record<ScheduleOutcome, MessageKey> = {
  done: "push.scheduleDone",
  failed: "push.scheduleFailed",
  stopped: "push.scheduleStopped",
  interrupted: "push.scheduleInterrupted",
};

export function messageKeyFor(a: Attention): MessageKey {
  if (a.kind === "schedule-run") return SCHEDULE_KEYS[a.outcome ?? "failed"];
  if (a.kind === "archive-held-back") return "push.archiveHeldBack";
  if (a.kind === "create-failed") return "push.createFailed";
  if (a.kind === "interrupted") return "push.interrupted";
  if (a.kind === "failed") return "push.failed";
  if (a.reason === "provider-limit") return "push.stoppedProviderLimit";
  if (a.reason === "tests-red") return "push.stoppedTestsRed";
  return "push.stoppedTimeout";
}
