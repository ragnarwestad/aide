import type { ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupAction, executionGroupActivity } from "../../../queue/execution-groups";
import { esc } from "../../ui/html.ts";
import { badge, btn, buttonForm, foldButton, stepLabel, type BadgeVariant } from "../../ui/components";
import type { SpecGroup } from "../specs-list";
import { isArchivedRow } from "../specs-list";
import { specBusy } from "../specs-list/row-state.ts";
import { createdLabel } from "../specs-list/cell-helpers.ts";
import { specPlace, type TabPlace } from "./rows.ts";
import { t } from "../../../i18n";

export interface ExecutionGroupMemberRow {
  key: string;
  group: SpecGroup;
  html: string;
}

const groupBadgeVariant = (state: ExecutionGroup["state"]): BadgeVariant => {
  if (state === "running" || state === "archiving") return "running";
  if (state === "stopped" || state === "waiting-acceptance") return "waiting";
  if (state === "completed") return "done";
  return state === "prepared" ? "ready" : "idle";
};

export function executionGroupPlace(group: ExecutionGroup, rows: ExecutionGroupMemberRow[] = []): TabPlace {
  const activity = executionGroupActivity(group.state);
  const band = activity === "running" ? 0 : activity === "queued" ? 1 : 2;
  const memberChanges = rows
    .filter((row) => group.members.includes(row.group.specFolder) && row.group.project === group.project)
    .map((row) => specPlace(row.group).changedAt);
  return { band, changedAt: Math.max(Date.parse(group.startedAt ?? group.createdAt ?? "") || 0, ...memberChanges) };
}

export function executionGroupCard(group: ExecutionGroup, rows: ExecutionGroupMemberRow[], lang = "en"): string {
  const members = group.members.map((folder) => rows.find((row) => row.group.project === group.project && row.group.specFolder === folder)).filter((row): row is ExecutionGroupMemberRow => !!row);
  const action = executionGroupAction(group, members.map(({ group: member }) => ({
    implemented: member.done.includes("implement"),
    archived: isArchivedRow(member),
    acceptanceOpen: !!member.acceptanceOpen,
    busy: specBusy(member),
  })));
  const key = `${group.project}\n${group.name}`;
  const created = createdLabel(group.createdAt);
  const control = action ? buttonForm({
    action: `/api/queue/groups/${encodeURIComponent(group.id)}/action`,
    hook: "actionform",
    hidden: { action },
    button: { label: action === "archive" ? stepLabel("archive", lang as never) : action === "stop" ? "Stop" : "Start" },
  }) : "";
  const edit = group.state === "prepared" && !group.startedAt
    ? btn({ label: t(lang as never, "list.groupEdit"), type: "button", data: { "edit-execution-group": group.id } })
    : "";
  const head = `<tr class="spechead execution-group-card" data-execution-group-card="1" data-spec-group="${esc(key)}">` +
    `<td class="foldcell" rowspan="2" data-col="fold">${foldButton({ label: group.name, open: false, data: { "group-toggle": key } })}</td>` +
    `<td colspan="2"><div class="spec-name"><strong>${esc(group.name)}</strong></div></td>` +
    `<td data-col="state"><span class="badgeslot">${badge(groupBadgeVariant(group.state), group.state)}</span></td>` +
    `<td colspan="2">${group.completedMembers.length} of ${group.members.length} done</td></tr>` +
    `<tr class="specstate" data-execution-group-actions data-execution-group-card="1">` +
    `<td colspan="2"><span class="row">${created ? `<span class="muted small">${esc(created)}</span>` : ""}${edit}</span></td>` +
    `<td data-col="state"><span class="actionslot">${control}</span></td>` +
    `<td data-col="started"></td><td data-col="cost"></td></tr>`;
  const memberRows = members.map((member) => {
    const membership = ` data-spec-group-member="${esc(key)}"`;
    const grouped = member.html.includes(" data-spec-group-member=")
      ? member.html.replace(/ data-spec-group-member="[^"]*"/, membership)
      : member.html.replace("<tr", `<tr${membership}`);
    return grouped.replaceAll("<tr", '<tr data-execution-group-card="1"');
  }).join("");
  return head + memberRows + `<tr class="specgap" data-execution-group-gap aria-hidden="true"><td colspan="6"></td></tr>`;
}
