import type { ExecutionGroup } from "../../queue/execution-groups";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";
import type { Language } from "../../i18n";
import type { Message } from "../types.ts";
import { specNumber } from "../../project/spec-folder.ts";
import { formatMessage } from "../format.ts";

export interface GroupStopMember {
  specFolder: string;
  lead?: QueueRowView;
}

const endedBadly = (lead: QueueRowView | undefined): boolean =>
  !!lead && ["stopped", "failed", "interrupted", "cancelled"].includes(lead.state);

export function getGroupStopMessage(
  group: Pick<ExecutionGroup, "project" | "state" | "currentMember" | "error"> & Partial<Pick<ExecutionGroup, "jobs">>,
  members: readonly GroupStopMember[],
  lang: Language,
): { specFolder?: string; notice: Message } | undefined {
  const archiveFailed = group.state === "archiving" && !!group.error;
  if (group.state !== "stopped" && !archiveFailed) return undefined;
  const member = group.currentMember
    ? members.find((member) => member.specFolder === group.currentMember)
    : [...(group.jobs ?? [])].reverse().map((job) => members.find((member) =>
      member.specFolder === job.specFolder && member.lead?.id === job.id && endedBadly(member.lead))).find(Boolean);
  if (member && (archiveFailed || endedBadly(member.lead))) {
    return {
      specFolder: member.specFolder,
      notice: { variant: "waiting", text: formatMessage(lang, {
        key: "group.memberStopped", values: { spec: `${group.project}:${specNumber(member.specFolder)}` },
      }) },
    };
  }
  return { notice: { variant: "waiting", text: formatMessage(lang, { key: "group.stopped" }) } };
}
