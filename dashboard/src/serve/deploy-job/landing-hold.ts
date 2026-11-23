import { deployBlockingLanding } from "../../queue/job-rules/deploy-priority.ts";
import type { BoardMessage } from "../../messages/types.ts";
import { type Job, type QueueStore } from "../../queue/queue.ts";
import { landingStepIndex } from "../../format/gerund.ts";
import { specReference } from "../../project/spec-folder.ts";

/** The landings a deploy waits for. A queued deploy waits for every one
 *  in flight, admitted at its repository or not: the deploy restarts the
 *  server, and a landing the restart catches is cut short. The queue's
 *  order decides only which of a deploy and a Merge not yet started goes
 *  first. */
export function deployWaitsFor(jobs: Job[], exceptJobId?: string, _admitted?: ReadonlySet<string>): Job[] {
  const deploy = jobs.find((job) => job.id === exceptJobId);
  return jobs.filter((job) => job.id !== exceptJobId && job.landing &&
    (deploy?.state === "queued" || !deploy?.deployWaitForLandings || deploy.deployWaitForLandings.includes(job.id)));
}

export function deployHold(jobs: Job[], exceptJobId?: string, admitted?: ReadonlySet<string>): BoardMessage {
  const landings: BoardMessage[] = deployWaitsFor(jobs, exceptJobId, admitted)
    .map((job): BoardMessage => job.steps[job.stepIndex] === "land" && job.branch
      // A Merge is named as its row is: by its branch, not as a spec.
      ? { key: "runner.mergeOfRunning", values: { branch: job.branch, project: job.project } }
      : {
        key: "runner.landingRunning",
        values: {
          doing: job.steps[landingStepIndex(job.state, job.stepIndex)] ?? "archive",
          spec: specReference(job.project, job.specFolder),
        },
      });
  return { key: "runner.landingPause", inner: landings.length ? landings : { key: "runner.landingUnnamed" } };
}

export async function waitForDeploy(
  queue: Pick<QueueStore, "list" | "get" | "update">,
  jobId: string,
  pollMs = 250,
): Promise<boolean> {
  let held = false;
  while (deployBlockingLanding(queue.list(), jobId)) {
    if (queue.get(jobId)?.state === "cancelled") return false;
    if (!held) {
      queue.update(jobId, { error: { key: "runner.deployPriority" }, errorReason: "held-back" });
      held = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (held && queue.get(jobId)?.errorReason === "held-back") queue.update(jobId, { error: undefined, errorReason: undefined });
  return queue.get(jobId)?.state !== "cancelled";
}
