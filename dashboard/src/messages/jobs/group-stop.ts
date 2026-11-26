import { automaticProviderWait } from "../../queue/job-rules/activity.ts";
import type { ExecutionGroup } from "../../queue/execution-groups";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";
import type { Language } from "../../i18n";
import type { Message } from "../types.ts";
import { specNumber } from "../../project/spec-folder.ts";
import { getUsageLimitMessage } from "../usage-limit/get.ts";
import { stepLabel } from "../../render/ui/components";
import { getJobMessage } from "./get.ts";
import { formatMessage } from "../format.ts";

export interface GroupStopMember {
  specFolder: string;
  lead?: QueueRowView;
}

const endedBadly = (lead: QueueRowView | undefined): boolean =>
  !!lead && ["waiting", "failed", "cancelled"].includes(lead.state);

type GroupStop = Pick<ExecutionGroup, "project" | "state" | "currentMember" | "error"> & Partial<Pick<ExecutionGroup, "jobs" | "stoppedByUser">>;

function stoppedMember(group: GroupStop, members: readonly GroupStopMember[]): GroupStopMember | undefined {
  return group.currentMember
    ? members.find((member) => member.specFolder === group.currentMember)
    : [...(group.jobs ?? [])].reverse().map((job) => members.find((member) =>
      member.specFolder === job.specFolder && member.lead?.id === job.id && endedBadly(member.lead))).find(Boolean);
}

export function groupProviderLimitWait(group: GroupStop, members: readonly GroupStopMember[]): QueueRowView | undefined {
  if (group.state !== "stopped" || group.stoppedByUser) return undefined;
  const lead = stoppedMember(group, members)?.lead;
  return lead && automaticProviderWait(lead) ? lead : undefined;
}

export function getGroupStopMessage(
  group: GroupStop,
  members: readonly GroupStopMember[],
  lang: Language,
  archiveJob?: QueueRowView,
): { specFolder?: string; notice: Message } | undefined {
  if (group.state === "archiving" && archiveJob?.state === "queued" && archiveJob.errorReason === "held-back") {
    const notice = getJobMessage(archiveJob, lang);
    if (notice) return { notice: { variant: notice.variant, text: formatMessage(lang, {
      key: "message.lead", values: { lead: stepLabel("archive", lang) }, inner: archiveJob.error,
    }) } };
  }
  const archiveFailed = group.state === "archiving" && !!group.error;
  if (group.state !== "stopped" && !archiveFailed) return undefined;
  if (group.state === "stopped" && group.stoppedByUser) return { notice: { variant: "info", text: formatMessage(lang, { key: "group.stoppedByUser" }) } };
  const waiting = groupProviderLimitWait(group, members);
  if (waiting) {
    const notice = getUsageLimitMessage(waiting, lang, Date.now());
    if (notice) return { specFolder: waiting.specFolder, notice };
  }
  const member = stoppedMember(group, members);
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
