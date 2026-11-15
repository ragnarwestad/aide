import type { SpecsPageOptions } from "./index.ts";
import type { SpecGroup } from "./data-model";
import type { QueueRowView } from "../../ui/job-state";
import type { Job } from "../../../queue/queue.ts";
import { isGroupMemberRun } from "../../../queue/execution-groups/actions.ts";
import { attemptsPerStep } from "./data-model/phases.ts";

function rowView(job: QueueRowView | Job): QueueRowView {
  if (typeof job.timeoutSec === "number") return job as QueueRowView;
  const stored = job as Job;
  return {
    ...stored,
    timeoutSec: 0,
    model: stored.model.archive,
    provider: stored.provider?.archive,
    stepModels: stored.model,
  } as unknown as QueueRowView;
}

/** Planned phases keep their choices, but only reached phases have attempts. */
export function groupArchiveAttempts(id: string, jobs: (QueueRowView | Job)[]): QueueRowView[] {
  return attemptsPerStep(jobs.filter((job) => job.executionGroupId === id && !isGroupMemberRun(job)).map(rowView)).archive ?? [];
}

/** Give grouped members the shared Archive attempt while retaining their fourth pip. */
export function withGroupArchive(source: SpecGroup, opts: Pick<SpecsPageOptions, "executionGroups" | "groupJobs">): SpecGroup {
  const execution = source.group && opts.executionGroups?.find((group) =>
    group.project === source.project && group.name === source.group?.name && group.members.length > 1);
  if (!execution) return source;
  const attempts = groupArchiveAttempts(execution.id, opts.groupJobs ?? []);
  return {
    ...source,
    phases: source.phases.map((phase) => phase.step === "archive" ? { ...phase, attempts } : phase),
    done: execution.state === "completed"
      ? [...new Set([...source.done, "archive"])]
      : source.done.filter((step) => step !== "archive"),
  };
}
