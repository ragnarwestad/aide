import type { ExecutionGroup } from "./types.ts";
import { automaticProviderWait, inFlight } from "../job-rules/activity.ts";

export type ExecutionGroupAction = "start" | "stop" | "archive" | "remove";
export type ExecutionGroupMenuAction = "edit" | "remove";

export interface ExecutionGroupMemberState {
  implemented: boolean;
  archived: boolean;
  acceptanceOpen: boolean;
  busy: boolean;
  automaticWaiting?: boolean;
}

/** Whether a member has done Implement: its files say so, or this group
 *  recorded its Implement as completed. The group's own record stands while
 *  the files are still read from the default branch, which gets a member's
 *  Implement only when the group archives. */
export function memberImplemented(
  group: Pick<ExecutionGroup, "completedMembers">, specFolder: string, done: readonly string[],
): boolean {
  return done.includes("implement") || group.completedMembers.includes(specFolder);
}

export const executionGroupActivity = (state: ExecutionGroup["state"]): "running" | "queued" | "idle" => {
  if (state === "running" || state === "archiving") return "running";
  return state === "queued" ? "queued" : "idle";
};

export function activeGroupForSpec(groups: readonly ExecutionGroup[], project: string, specFolder: string): ExecutionGroup | undefined {
  return groups.find((group) => group.project === project && !group.removedAt &&
    group.state !== "completed" && group.members.includes(specFolder));
}

type GroupQueue = {
  list(): readonly { project: string; specFolder: string; state: string; landing?: boolean }[];
  executionGroups?: { list(): ExecutionGroup[] };
};

function memberHasLiveJob(queue: GroupQueue, project: string, specFolder: string): boolean {
  return queue.list().some((job) => job.project === project && job.specFolder === specFolder && inFlight(job));
}

/** An unfinished group owns individual Run until completion or removal.
 *  A member's own live job keeps its ordinary controls. */
export function groupBlocksIndividualRun(queue: GroupQueue, project: string, specFolder: string): boolean {
  return !!activeGroupForSpec(queue.executionGroups?.list() ?? [], project, specFolder) &&
    !memberHasLiveJob(queue, project, specFolder);
}

/** Members without their own live job are reserved while the group has work in flight.
 *  Prepared and stopped groups do not block the other spec actions that use this guard. */
export function groupReservesSpec(queue: GroupQueue, project: string, specFolder: string): boolean {
  return !!queue.executionGroups?.list().find((group) => group.project === project && !group.removedAt &&
    executionGroupActivity(group.state) !== "idle" && group.members.includes(specFolder)) &&
    !memberHasLiveJob(queue, project, specFolder);
}

export function executionGroupAction(
  group: Pick<ExecutionGroup, "state"> & Partial<Pick<ExecutionGroup, "stoppedByUser">>,
  members: readonly ExecutionGroupMemberState[],
): ExecutionGroupAction | undefined {
  if (executionGroupFinished(group, members)) return "remove";
  if (members.length === 0) return undefined;
  if (executionGroupActivity(group.state) !== "idle" ||
    (!group.stoppedByUser && members.some((member) => member.automaticWaiting))) return "stop";
  if (members.every((member) => member.implemented)) {
    return members.every((member) => !member.acceptanceOpen && !member.busy) ? "archive" : undefined;
  }
  if (group.state === "prepared" || group.state === "stopped" || group.state === "waiting-acceptance") return "start";
  return undefined;
}

/** A group is finished when it completed, or when it is idle and every spec in
 *  it is archived: nothing is left for it to do, whatever state it stopped in. */
export function executionGroupFinished(
  group: Pick<ExecutionGroup, "state">,
  members: readonly Pick<ExecutionGroupMemberState, "archived">[],
): boolean {
  return group.state === "completed" ||
    (executionGroupActivity(group.state) === "idle" && members.length > 0 && members.every((member) => member.archived));
}

export function canRemoveExecutionGroup(group: Pick<ExecutionGroup, "state">, busy = false): boolean {
  return executionGroupActivity(group.state) === "idle" && !busy;
}

export function canEditExecutionGroup(group: Pick<ExecutionGroup, "state">, busy = false): boolean {
  return group.state !== "completed" && canRemoveExecutionGroup(group, busy);
}

/** Splits a group's controls between its single State/Action button and
 *  the card menu. */
export function executionGroupControls(
  group: Pick<ExecutionGroup, "state"> & Partial<Pick<ExecutionGroup, "stoppedByUser">>,
  members: readonly ExecutionGroupMemberState[],
): { action: Exclude<ExecutionGroupAction, "remove"> | undefined; menu: ExecutionGroupMenuAction[]; disabledMenu: ExecutionGroupMenuAction[] } {
  const decided = executionGroupAction(group, members);
  const busy = members.some((member) => member.busy);
  const menu: ExecutionGroupMenuAction[] = executionGroupFinished(group, members) ? ["remove"] : ["edit", "remove"];
  return {
    action: decided === "remove" ? undefined : decided,
    menu,
    disabledMenu: menu.filter((item) => !(item === "edit" ? canEditExecutionGroup(group, busy) : canRemoveExecutionGroup(group, busy))),
  };
}

const MEMBER_STEPS = ["analyze", "implement"] as const;

/** The steps a group's Start runs on a member: the Analyze and Implement
 *  ticked on its row, or, with neither ticked, the ones it has not done. */
export function groupMemberSteps(ticked: readonly string[] | undefined, done: readonly string[]): string[] {
  const chosen = MEMBER_STEPS.filter((step) => ticked?.includes(step));
  if (chosen.length) return chosen;
  return MEMBER_STEPS.filter((step) => !done.includes(step));
}

/** A member's old bundled phase list must never start its own Archive.
 *  The shared Archive has groupMembers, or an Archive-only phase list. */
export function isGroupMemberRun(job: { executionGroupId?: string; groupMembers?: string[]; steps: readonly string[] }): boolean {
  return !!job.executionGroupId && !job.groupMembers?.length && job.steps.some((step) => step === "analyze" || step === "implement");
}

/** The current member's automatic pause owns the group's phase plan until Stop. */
export function waitingGroupJob<T extends { project: string; specFolder: string; state: string; createdAt: string; stopReason?: string; usageLimitWait?: { until: string } }>(
  group: Pick<ExecutionGroup, "project" | "members" | "state" | "stoppedByUser" | "currentMember">, jobs: readonly T[],
): T | undefined {
  if (group.state !== "stopped" || group.stoppedByUser) return undefined;
  const latest = jobs.filter((job) => job.project === group.project &&
    (group.currentMember ? job.specFolder === group.currentMember : group.members.includes(job.specFolder)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return latest && automaticProviderWait(latest) ? latest : undefined;
}
