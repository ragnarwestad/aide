// What a running job can still be given: a step it has not reached yet,
// and where in its tail an added step goes. The store reads, checks and
// writes in one synchronous call; these only compute.

import { tailEdits, WORKFLOW_STEPS, type WorkflowStep } from "../steps.ts";
import type { Job } from "../types.ts";
import { invalidRequest } from "../parse-request.ts";

/** The step a tail edit names, when the job can still be given it, or
 *  the one sentence that says why not. It names the step: the row has a
 *  single line to say why a tick or a pick did not take. */
export function tailEditStep(
  job: Job,
  step: string,
): { step: WorkflowStep } | { error: string } {
  const named = step || "that step";
  const wanted = WORKFLOW_STEPS.find((s) => s === step);
  if (wanted && tailEdits(job).includes(wanted)) return { step: wanted };
  return {
    error: invalidRequest(
      job.state === "running"
        ? `${named} is not a step this run can still be given`
        : `${named} cannot be changed: this job is ${job.state}, not running`,
    ),
  };
}

/** The job's steps with `step` added to or taken out of its tail. An
 *  added step goes into the TAIL at its own rank, never at the array's
 *  end: a job running analyze that is given archive and then implement
 *  must run implement first. */
export function withTailStep(
  job: Job,
  step: WorkflowStep,
  add: boolean,
): WorkflowStep[] {
  const head = job.steps.slice(0, job.stepIndex + 1);
  const tail = job.steps.slice(job.stepIndex + 1);
  if (add) {
    const rank = WORKFLOW_STEPS.indexOf(step);
    const before = tail.findIndex((s) => WORKFLOW_STEPS.indexOf(s) > rank);
    tail.splice(before === -1 ? tail.length : before, 0, step);
  } else {
    tail.splice(tail.indexOf(step), 1);
  }
  return [...head, ...tail];
}
