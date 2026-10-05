// A spec's work round as the Logs tab reads it: the jobs after the last
// reset, newest first, and the key each step gets there. `stepsOfRound`
// builds the tab's list (`steps` and the lead job's `runningStep`) for the
// spec page and for the answer that follows it; a test builds the real page
// view and holds the keys to the same list.
import { currentWorkRoundJobs } from "../../queue/steps.ts";
import type { Job, QueueStore } from "../../queue/queue.ts";
import type { JobDetailView, JobStepResultView } from "../../render";

/** The spec's jobs in its current work round, newest first. */
export function workRoundJobs(queue: Pick<QueueStore, "list">, project: string, specFolder: string): Job[] {
  const matching = queue.list().filter((j) => j.project === project && j.specFolder === specFolder);
  return currentWorkRoundJobs(matching).sort(
    (a, b) => (Date.parse(b.startedAt ?? b.createdAt) || 0) - (Date.parse(a.startedAt ?? a.createdAt) || 0),
  );
}

const inFlight = (j: Job): boolean => j.state === "queued" || j.state === "running" || !!j.landing;

/** The spec's jobs in its round, the lead job's view and every step of the
 *  round: what the Steps tab draws. The lead is whatever is in flight, or
 *  failing that the most recently active — the rule `jobGroup` uses for the
 *  row's own lead, over the same in-flight states and the same "started, or
 *  failing that created" clock, so the page a name opens speaks for the job
 *  the name spoke for.
 *
 *  An attempt is numbered only when there is more than one job — a
 *  single-attempt spec draws no marker at all (spec 242's own "nothing to
 *  show, show nothing" rule, at row level). `jobs` is newest-first, so the
 *  oldest is attempt 1 and the steps flatten in reverse. */
export async function stepsOfRound(
  queue: Pick<QueueStore, "list">,
  detail: (job: Job) => Promise<JobDetailView>,
  project: string,
  specFolder: string,
): Promise<{ jobs: Job[]; lead: JobDetailView | undefined; steps: JobStepResultView[] }> {
  const jobs = workRoundJobs(queue, project, specFolder);
  const leadJob = jobs.find(inFlight) ?? jobs[0];
  const jobDetails = await Promise.all(jobs.map(detail));
  const multiAttempt = jobs.length > 1;
  const attemptNumber = (j: Job): number | undefined => (multiAttempt ? jobs.length - jobs.indexOf(j) : undefined);
  const leadDetail = leadJob ? jobDetails[jobs.indexOf(leadJob)] : undefined;
  const lead = leadDetail && {
    ...leadDetail,
    runningStep: leadDetail.runningStep && { ...leadDetail.runningStep, attempt: attemptNumber(leadJob!) },
  };
  const steps = jobs
    .map((j, i) => jobDetails[i]!.results.map((r) => ({ ...r, attempt: attemptNumber(j) })))
    .reverse()
    .flat();
  return { jobs, lead, steps };
}

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
