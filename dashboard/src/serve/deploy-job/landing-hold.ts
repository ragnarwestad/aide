import type { BoardMessage } from "../../messages/types.ts";
import { inFlight, jobKind, type Job } from "../../queue/queue.ts";
import { landingStepIndex } from "../../format/gerund.ts";
import { specReference } from "../../project/spec-folder.ts";

export function deployWaitsFor(jobs: Job[], project?: string, exceptJobId?: string): Job[] {
  return jobs.filter((job) => job.id !== exceptJobId && (job.landing ||
    (project === job.project && jobKind(job) === "land" && inFlight(job))));
}

export function deployHold(jobs: Job[], exceptJobId?: string, project?: string): BoardMessage {
  const landings: BoardMessage[] = deployWaitsFor(jobs, project, exceptJobId)
    .map((job) => ({
      key: "runner.landingRunning",
      values: {
        doing: job.steps[landingStepIndex(job.state, job.stepIndex)] ?? "archive",
        spec: specReference(job.project, job.specFolder),
      },
    }));
  return { key: "runner.landingPause", inner: landings.length ? landings : { key: "runner.landingUnnamed" } };
}
