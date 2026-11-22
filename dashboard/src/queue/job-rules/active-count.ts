import { heldBackResolvesOnItsOwn } from "../../messages/jobs/holds.ts";
import { createEndedWithoutSpec } from "../create-failure.ts";
import type { ExecutionGroup } from "../execution-groups";
import { executionGroupActivity } from "../execution-groups/actions.ts";
import { jobKind, waitsForPerson } from "../steps.ts";
import type { Job } from "../types.ts";
import { automaticProviderWait, writing } from "./activity.ts";

const STOPS_SHORT_OF_ARCHIVE = new Set(["analyze", "implement"]);
const SPEC_KINDS = new Set(["spec", "close", "reopen"]);

/** The Jobs tab's count: jobs running, and jobs that cannot finish until a
 *  person acts. A job waiting in the queue or on a usage limit's automatic
 *  retry continues on its own and is not counted. The newest attempt for a
 *  branch, spec or schedule decides; a group counts once, by its own state. */
export function activeJobCount(
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
    const scope = SPEC_KINDS.has(kind) ? "spec" : kind;
    const key = JSON.stringify([job.project, scope, target]);
    const previous = latest.get(key);
    if (!previous || job.createdAt > previous.createdAt) latest.set(key, job);
  }

  const liveGroups = new Map(groups.filter(group => !group.removedAt).map(group => [group.id, group]));
  const active = new Set<string>();
  // A group running counts, and so does one that is prepared, stopped or
  // waiting for acceptance: each goes on only when a person acts.
  for (const group of liveGroups.values()) {
    if (!serves(group.project) || group.state === "completed") continue;
    if (executionGroupActivity(group.state) !== "queued") active.add(group.id);
  }
  for (const job of latest.values()) {
    if (job.removedAt || (job.executionGroupId && liveGroups.has(job.executionGroupId))) continue;
    if (automaticProviderWait(job)) continue;
    const kind = jobKind(job);
    if (kind === "schedule" && !hasSchedule(job.project, job.specFolder)) continue;
    const manualHold = job.errorReason === "held-back" && !heldBackResolvesOnItsOwn(job);
    const choice = job.state === "done" && job.results.at(-1)?.terminalReason === "approach-choice";
    // An open spec run through analyze or implement and not on to archive
    // waits for a person to start its next step.
    const nextStepAhead = job.state === "done" && STOPS_SHORT_OF_ARCHIVE.has(job.steps.at(-1) ?? "") &&
      openSpec(job.project, job.specFolder);
    // A cancelled Merge leaves its branch unmerged, and a cancelled step
    // leaves its open spec unfinished; any other cancelled job is over.
    const cancelledUnfinished = job.state === "cancelled" &&
      (kind === "land" || (SPEC_KINDS.has(kind) && openSpec(job.project, job.specFolder)));
    if (writing(job) || manualHold || choice || nextStepAhead || cancelledUnfinished || waitsForPerson(job) || createEndedWithoutSpec(job)) {
      active.add(job.id);
    }
  }
  return active.size;
}
