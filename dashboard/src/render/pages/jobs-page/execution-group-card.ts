import type { ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupAction, executionGroupActivity } from "../../../queue/execution-groups";
import { esc } from "../../ui/html.ts";
import { btn, buttonForm, foldButton, stepLabel } from "../../ui/components";
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
  const archiveLabel = action === "archive" ? " Group Archive" : "";
  const head = `<tr class="execution-group-card" data-spec-group="${esc(key)}"><td colspan="6">` +
    foldButton({ label: group.name, open: false, data: { "group-toggle": key } }) +
    `<strong>${esc(group.name)}</strong> · ${esc(group.state)} · ${group.completedMembers.length} of ${group.members.length} done` +
    (created ? `<br><span class="muted small">${esc(created)}</span>` : "") +
    edit + control + archiveLabel + `</td></tr>`;
  return head + members.map((member) => member.html).join("");
}
