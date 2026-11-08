// The hold that looks at the rest of a job's own project: a job that must
// not run beside other work in it waits while that work is in flight. `Runner.tick()` holds a job with the sentence
// this answers, and starts it on a later pass once nothing is in the way.

import type { BoardMessage } from "../../i18n/message.ts";
import type { Job } from "../queue.ts";

/** Running now, or finished but still being merged: a landing is a merge in
 *  progress in the project's repositories. */
const inFlight = (r: Job): boolean => r.state === "running" || r.landing === true;

const stepOf = (r: Job) => r.steps[r.stepIndex];

/** The sentence a queued job is held with while other work of its project is
 *  in flight, or undefined when nothing holds it.
 *
 *  A schedule job never starts while anything else for its project is running
 *  or landing — the same shape as the archive hold in
 *  `tick()`, but wider (any step, not only archive) and one-directional: only
 *  the schedule job itself ever waits for this, nothing holds a spec's own
 *  step or landing back for a queued schedule job. */
export function projectHold(jobs: readonly Job[], job: Job): BoardMessage | undefined {
  const others = jobs.filter((r) => r.project === job.project && r.id !== job.id);
  if (stepOf(job) === "schedule" && others.some(inFlight)) {
    return { key: "runner.scheduleWaitsOnProject" };
  }
  return undefined;
}
