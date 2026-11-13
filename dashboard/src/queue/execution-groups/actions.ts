import type { ExecutionGroup } from "./types.ts";

export type ExecutionGroupAction = "start" | "stop" | "archive" | "remove";

export interface ExecutionGroupMemberState {
  implemented: boolean;
  archived: boolean;
  acceptanceOpen: boolean;
  busy: boolean;
}

export const executionGroupActivity = (state: ExecutionGroup["state"]): "running" | "queued" | "idle" => {
  if (state === "running" || state === "archiving") return "running";
  return state === "queued" ? "queued" : "idle";
};

export function executionGroupAction(
  group: Pick<ExecutionGroup, "state">,
  members: readonly ExecutionGroupMemberState[],
): ExecutionGroupAction | undefined {
  if (group.state === "completed") return "remove";
  if (members.length === 0 || members.every((member) => member.archived)) return undefined;
  if (executionGroupActivity(group.state) !== "idle") return "stop";
  if (members.every((member) => member.implemented)) {
    return members.every((member) => !member.acceptanceOpen && !member.busy) ? "archive" : undefined;
  }
  if (group.state === "prepared" || group.state === "stopped" || group.state === "waiting-acceptance") return "start";
  return undefined;
}

/** Why a group can take no more specs: archived, being archived, or every
 *  member through Implement, which a group waiting for Archive always is. */
export type ExecutionGroupAddRefusal = "archiving" | "completed" | "implemented";

/** Whether a spec may be added at the end of the group's order: nothing
 *  stops it, or the reason something does. */
export function executionGroupAddRefusal(
  group: Pick<ExecutionGroup, "state">,
  members: readonly ExecutionGroupMemberState[],
): ExecutionGroupAddRefusal | undefined {
  if (group.state === "completed") return "completed";
  if (group.state === "archiving") return "archiving";
  if (members.length === 0 || members.every((member) => member.implemented || member.archived)) return "implemented";
  return undefined;
}
