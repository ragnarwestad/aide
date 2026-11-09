import type { BoardMessage } from "../../i18n/message.ts";
import type { Job } from "../../queue/queue.ts";
import { landingStepIndex } from "../../format/gerund.ts";
import { specReference } from "../../project/spec-folder.ts";

export function deployHold(jobs: Job[], exceptJobId?: string): BoardMessage {
  const landings: BoardMessage[] = jobs
    .filter((job) => job.landing && job.id !== exceptJobId)
    .map((job) => ({
      key: "runner.landingRunning",
      values: {
        doing: job.steps[landingStepIndex(job.state, job.stepIndex)] ?? "archive",
        spec: specReference(job.project, job.specFolder),
      },
    }));
  return { key: "runner.landingPause", inner: landings.length ? landings : { key: "runner.landingUnnamed" } };
}
