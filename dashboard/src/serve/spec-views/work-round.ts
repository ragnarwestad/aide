// A spec's work round as the Logs tab reads it: the jobs after the last
// reset, newest first, and the key each step gets there. `spec-page.ts`
// builds the tab's list itself (`steps` and `runningStep`); a test builds
// the real page view and holds the two to the same keys.
import { currentWorkRoundJobs } from "../../queue/steps.ts";
import type { Job, QueueStore } from "../../queue/queue.ts";

/** The spec's jobs in its current work round, newest first. */
export function workRoundJobs(queue: Pick<QueueStore, "list">, project: string, specFolder: string): Job[] {
  const matching = queue.list().filter((j) => j.project === project && j.specFolder === specFolder);
  return currentWorkRoundJobs(matching).sort(
    (a, b) => (Date.parse(b.startedAt ?? b.createdAt) || 0) - (Date.parse(a.startedAt ?? a.createdAt) || 0),
  );
}

const inFlight = (j: Job): boolean => j.state === "queued" || j.state === "running" || !!j.landing;

/** The `&step=` key the Logs tab gives one step of one job — `live` for
 *  the step now running on the lead job, otherwise the step's index in the
 *  round's results, oldest job first. Undefined when the step has no row
 *  there (a job from before a reset, a step not yet run). */
export function stepKey(jobs: Job[], job: Job, step: string): string | undefined {
  const lead = jobs.find(inFlight) ?? jobs[0];
  if (job === lead && job.state === "running" && job.steps[job.stepIndex] === step) return "live";
  const oldestFirst = [...jobs].reverse();
  const at = oldestFirst.indexOf(job);
  if (at < 0) return undefined;
  const within = job.results.findIndex((r) => r.step === step);
  if (within < 0) return undefined;
  const before = oldestFirst.slice(0, at).reduce((sum, j) => sum + j.results.length, 0);
  return String(before + within);
}
