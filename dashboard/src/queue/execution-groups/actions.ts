import type { ExecutionGroup } from "./types.ts";

export type ExecutionGroupAction = "start" | "stop" | "archive" | "remove";
export type ExecutionGroupMenuAction = "edit" | "remove";

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

/** Splits a group's controls between its single State/Action button and
 *  the card menu. */
export function executionGroupControls(
  group: Pick<ExecutionGroup, "state">,
  members: readonly ExecutionGroupMemberState[],
): { action: Exclude<ExecutionGroupAction, "remove"> | undefined; menu: ExecutionGroupMenuAction[] } {
  const decided = executionGroupAction(group, members);
  return {
    action: decided === "remove" ? undefined : decided,
    menu: group.state === "completed" ? ["remove"] : group.state === "archiving" ? [] : ["edit"],
  };
}
