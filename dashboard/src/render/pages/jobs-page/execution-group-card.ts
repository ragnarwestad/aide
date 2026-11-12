import type { ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupAction, executionGroupActivity } from "../../../queue/execution-groups";
import { esc } from "../../ui/html.ts";
import { badge, buttonForm, foldButton, stepLabel, type BadgeVariant } from "../../ui/components";
import type { SpecGroup } from "../specs-list";
import { isArchivedRow } from "../specs-list";
import { specBusy } from "../specs-list/row-state.ts";
import { createdLabel } from "../specs-list/cell-helpers.ts";
import { specPlace, type TabPlace } from "./rows.ts";
import { columnGroup } from "../specs-list/filter-bar.ts";
import { projectLink } from "../../ui/components/spec-name.ts";

export interface ExecutionGroupMemberRow {
  key: string;
  group: SpecGroup;
  html: string;
}

/** The id the group's row carries, the anchor the page's row swap finds it by. */
export const executionGroupAnchor = (group: Pick<ExecutionGroup, "id" | "project" | "name">): string =>
  `group-${group.id || `${group.project}-${group.name}`}`.replace(/\s+/g, "-");

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
  // The card is one cell of the list holding a table of its own: the group's
  // two lines, then its members drawn exactly as on the list, each its own
  // card. A cell has one border, so the card around the specs cannot be
  // drawn on the specs' own cells.
  // Shut, unless a member's spec is open in it: the address that opens a
  // spec opens its group too.
  const open = members.some((member) => member.html.includes(" data-spec-detail="));
  const shut = open ? "" : " hidden";
  const head = `<tbody data-group-head><tr class="grouphead">` +
    `<td class="foldcell" data-col="fold">${foldButton({ label: group.name, open, data: { "group-toggle": key } })}</td>` +
    `<td colspan="2"><div class="spec-name"><span class="label">${projectLink(group.project, { className: "muted" })}` +
    `<span class="muted">:</span><span class="specname">${esc(group.name)}</span></span></div></td>` +
    `<td data-col="state"><span class="badgeslot">${badge(groupBadgeVariant(group.state), group.state)}</span></td>` +
    `<td colspan="2">${group.completedMembers.length} of ${group.members.length} done</td></tr>` +
    `<tr class="groupactions" data-execution-group-actions data-group-body${shut}>` +
    `<td></td><td colspan="2"><span class="row">${created ? `<span class="muted small">${esc(created)}</span>` : ""}</span></td>` +
    `<td data-col="state"><span class="actionslot">${control}</span></td>` +
    `<td></td><td></td></tr></tbody>`;
  const memberRows = `<tbody data-group-members data-group-body${shut}>` + members.map((member) => {
    const membership = ` data-spec-group-member="${esc(key)}"`;
    return member.html.includes(" data-spec-group-member=")
      ? member.html.replace(/ data-spec-group-member="[^"]*"/, membership)
      : member.html.replace("<tr", `<tr${membership}`);
  }).join("") + `</tbody>`;
  return `<tr class="execution-group" id="${esc(executionGroupAnchor(group))}" data-spec-group="${esc(key)}">` +
    `<td class="groupcell" colspan="6"><table class="list speclist groupcard">${columnGroup()}${head}${memberRows}</table></td></tr>` +
    `<tr class="specgap" aria-hidden="true"><td colspan="6"></td></tr>`;
}
