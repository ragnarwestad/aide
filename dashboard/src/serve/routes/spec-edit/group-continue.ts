// An edited running or queued group can be left waiting for Archive while
// the saved order still contains unfinished work. The edit picks it up.

import { inFlight, type QueueStore } from "../../../queue/queue.ts";
import { enqueueRequest, withRowPicks } from "../../../queue/request/index.ts";
import { groupMemberSteps, type ExecutionGroupState } from "../../../queue/execution-groups";

/** Queues the added spec as the group's next job when the group was running
 *  or queued before the add and has since been left waiting for Archive with
 *  no member in flight, on the steps `groupMemberSteps` gives it. `done` is
 *  the steps a member has done. Answers whether it queued one. */
export function continueAfterEdit(
  queue: QueueStore, groupId: string, stateBefore: ExecutionGroupState, done: (folder: string) => readonly string[] = () => [],
): boolean {
  if (stateBefore !== "running" && stateBefore !== "queued") return false;
  const group = queue.executionGroups.get(groupId);
  if (!group || group.state !== "waiting-acceptance") return false;
  if (queue.list().some((job) => job.project === group.project && group.members.includes(job.specFolder) && inFlight(job))) return false;
  const member = group.members.find((folder) => !group.completedMembers.includes(folder) && group.memberSteps?.[folder]?.length !== 0);
  if (!member) return false;
  const made = enqueueRequest(queue, withRowPicks({
    project: group.project, specFolder: member, executionGroupId: group.id,
    steps: group.memberSteps?.[member] ?? groupMemberSteps(queue.pendingSteps[`${group.project}/${member}`], done(member)),
  }, queue), "automatic");
  if (!made.ok) return false;
  queue.executionGroups.queueMember(group.id, member);
  return true;
}
