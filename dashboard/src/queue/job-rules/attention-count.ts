import { heldBackResolvesOnItsOwn } from "../../messages/jobs/holds.ts";
import { createEndedWithoutSpec } from "../create-failure.ts";
import type { ExecutionGroup } from "../execution-groups";
import { jobKind, waitsForPerson } from "../steps.ts";
import type { Job } from "../types.ts";
import { automaticProviderWait, writing } from "./activity.ts";

const STOPS_SHORT_OF_ARCHIVE = new Set(["analyze", "implement"]);

/** The newest attempt owns the attention state, even when it is already running. */
export function jobsNeedingAttention(
  jobs: readonly Job[],
  groups: readonly ExecutionGroup[],
  serves: (project: string) => boolean,
  hasSchedule: (project: string, key: string) => boolean,
  openSpec: (project: string, specFolder: string) => boolean,
): number {
  const latest = new Map<string, Job>();
  for (const job of jobs) {
    if (!serves(job.project)) continue;
    const kind = jobKind(job);
    const target = kind === "land" ? job.branch ?? job.id : job.specFolder;
    const scope = kind === "close" || kind === "reopen" ? "spec" : kind;
    const key = JSON.stringify([job.project, scope, target]);
    const previous = latest.get(key);
    if (!previous || job.createdAt > previous.createdAt) latest.set(key, job);
  }

  const liveGroups = new Map(groups.filter(group => !group.removedAt).map(group => [group.id, group]));
  const attention = new Set<string>();
  for (const group of liveGroups.values()) {
    if (serves(group.project) && group.state === "waiting-acceptance") attention.add(group.id);
  }
  for (const job of latest.values()) {
    if (job.removedAt || job.state === "cancelled" || writing(job) || automaticProviderWait(job)) continue;
    if (jobKind(job) === "schedule" && !hasSchedule(job.project, job.specFolder)) continue;
    const group = job.executionGroupId && liveGroups.get(job.executionGroupId);
    if (group && (group.stoppedByUser || group.state === "prepared" || group.state === "completed")) continue;
    const manualHold = job.errorReason === "held-back" && !heldBackResolvesOnItsOwn(job);
    const choice = job.state === "done" && job.results.at(-1)?.terminalReason === "approach-choice";
    // An open spec run through analyze or implement and not on to archive
    // waits for a person to start its next step; a group member waits on its group.
    const nextStepAhead = !group && job.state === "done" && STOPS_SHORT_OF_ARCHIVE.has(job.steps.at(-1) ?? "") &&
      openSpec(job.project, job.specFolder);
    if (manualHold || choice || nextStepAhead || waitsForPerson(job) || createEndedWithoutSpec(job)) attention.add(group ? group.id : job.id);
  }
  return attention.size;
}
