// What a job's write tells the execution group it belongs to: the job's
// logs, and the state the group moves to with it.

import type { ExecutionGroupStore } from "../execution-groups/index.ts";
import type { Job } from "../types.ts";

/** Bring `job`'s group up to date with `job`, read beside the other jobs in `queued`. */
export function syncExecutionGroup(groups: ExecutionGroupStore, queued: Iterable<Job>, job: Job): void {
  if (!job.executionGroupId || !groups.get(job.executionGroupId)) return;
  const group = groups.get(job.executionGroupId)!;
  const history = {
    id: job.id,
    specFolder: job.specFolder,
    logs: job.results.map((result) => ({ step: result.step, sessionId: result.sessionId, streamFile: result.streamFile })),
  };
  const jobs = [...group.jobs.filter((entry) => entry.id !== job.id), history];
  // A job that ends done or cancelled with nothing else of its group in
  // flight leaves the group idle; one that waits for Archive keeps waiting.
  // The group's archive job keeps it archiving until its landing settles.
  const othersInFlight = [...queued].some((other) =>
    other.id !== job.id && other.executionGroupId === group.id && (other.state === "queued" || other.state === "running"));
  const archive = job.steps[job.stepIndex] === "archive";
  const state = job.state === "waiting" || job.state === "failed" ? "stopped"
    : archive && (job.state === "queued" || job.state === "running") ? "archiving"
      : job.state === "running" ? "running"
        : job.state === "queued" ? "queued"
          : archive && job.state === "done" && (group.state === "running" || group.state === "queued") ? "archiving"
            : archive && job.state === "cancelled" && group.state === "archiving" ? "stopped"
              : (group.state === "running" || group.state === "queued") && !othersInFlight && !job.landing ? "stopped"
              : group.state;
  groups.update(group.id, { jobs, state, currentMember: job.specFolder });
}
