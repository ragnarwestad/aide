// A spec added to a running or queued group whose last member finished
// Implement between the add's check and its save: the group's continuation
// read the specs before the added spec had its lines, found no next member
// and left the group waiting for Archive. The add picks the run up itself.

import { inFlight, type QueueStore } from "../../../queue/queue.ts";
import { enqueueRequest, withRowPicks } from "../../../queue/request/index.ts";
import type { ExecutionGroupState } from "../../../queue/execution-groups";

/** Queues the added spec as the group's next job when the group was running
 *  or queued before the add and has since been left waiting for Archive with
 *  no member in flight. Answers whether it queued one. */
export function continueAfterAdd(queue: QueueStore, groupId: string, member: string, stateBefore: ExecutionGroupState): boolean {
  if (stateBefore !== "running" && stateBefore !== "queued") return false;
  const group = queue.executionGroups.get(groupId);
  if (!group || group.state !== "waiting-acceptance") return false;
  if (queue.list().some((job) => job.project === group.project && group.members.includes(job.specFolder) && inFlight(job))) return false;
  const made = enqueueRequest(queue, withRowPicks({
    project: group.project, specFolder: member, steps: ["analyze", "implement"], executionGroupId: group.id,
  }, queue), "automatic");
  if (!made.ok) return false;
  queue.executionGroups.queueMember(group.id, member);
  return true;
}
