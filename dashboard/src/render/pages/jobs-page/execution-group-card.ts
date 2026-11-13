import type { ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupActivity, executionGroupControls } from "../../../queue/execution-groups";
import { esc } from "../../ui/html.ts";
import { badge, buttonForm, foldButton, headerMenu, kindIcon, pips, stepLabel, type BadgeVariant, type PipKind } from "../../ui/components";
import type { SpecGroup, SpecTarget } from "../specs-list";
import { isArchivedRow } from "../specs-list";
import { specBusy } from "../specs-list/row-state.ts";
import { activeDurationCell, costCell, createdLabel } from "../specs-list/cell-helpers.ts";
import { specPlace, type TabPlace } from "./rows.ts";
import { columnGroup } from "../specs-list/filter-bar.ts";
import { projectLink } from "../../ui/components/spec-name.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { executionGroupEditor } from "./execution-group-editor.ts";
import { ICON_MORE } from "../../ui/components/icons.ts";
import { executionGroupWaitRows } from "./execution-group-waiting.ts";

export interface ExecutionGroupMemberRow {
  key: string;
  group: SpecGroup;
  html: string;
}

/** The id the group's row carries, the anchor the page's row swap finds it by. */
export const executionGroupAnchor = (group: Pick<ExecutionGroup, "id" | "project" | "name">): string =>
  `group-${group.id || `${group.project}-${group.name}`}`.replace(/\s+/g, "-");

const GROUP_STATE_KEY = {
  prepared: "list.groupState.prepared",
  queued: "list.groupState.queued",
  running: "list.groupState.running",
  stopped: "list.groupState.stopped",
  // The words a spec's own badge says in the same place.
  "waiting-acceptance": "wordPhase.badgeHeldBack",
  archiving: "list.groupState.archiving",
  completed: "list.done",
} as const satisfies Record<ExecutionGroup["state"], TranslationKey>;

const groupBadgeVariant = (state: ExecutionGroup["state"]): BadgeVariant => {
  if (state === "running" || state === "archiving") return "running";
  if (state === "stopped" || state === "waiting-acceptance") return "waiting";
  if (state === "completed") return "done";
  return state === "prepared" ? "ready" : "idle";
};

/** A member's pip, in the colour its own badge has: done, running, failed,
 *  stopped or held back, or not started. */
export function memberPipKind(member: SpecGroup | undefined, completed: boolean): PipKind {
  if (completed || (member && isArchivedRow(member))) return "past";
  if (!member) return "todo";
  if (specBusy(member)) return "now";
  if (["failed", "cancelled", "interrupted", "archived-unlanded"].includes(member.state)) return "refused";
  const heldBack = !!member.phases.find((p) => p.step === "archive")?.heldBack;
  return member.state === "stopped" || heldBack ? "waiting" : "todo";
}

export function executionGroupPlace(group: ExecutionGroup, rows: ExecutionGroupMemberRow[] = []): TabPlace {
  const activity = executionGroupActivity(group.state);
  const band = activity === "running" ? 0 : activity === "queued" ? 1 : group.state === "completed" ? 3 : 2;
  const memberChanges = rows
    .filter((row) => group.members.includes(row.group.specFolder) && row.group.project === group.project)
    .map((row) => specPlace(row.group).changedAt);
  return { band, changedAt: Math.max(Date.parse(group.startedAt ?? group.createdAt ?? "") || 0, ...memberChanges) };
}

/** `openFor`: the chosen state entries the card is shown for, which draw it open. */
export function executionGroupCard(
  group: ExecutionGroup, rows: ExecutionGroupMemberRow[], lang = "en",
  opts: { openFor?: string; candidates?: SpecTarget[]; locked?: ReadonlySet<string> } = {},
): string {
  const members = group.members.map((folder) => rows.find((row) => row.group.project === group.project && row.group.specFolder === folder)).filter((row): row is ExecutionGroupMemberRow => !!row);
  const totalDurationMs = members.reduce((sum, member) => sum + (member.group.totalDurationMs ?? 0), 0);
  const liveMember = members.find((member) => member.group.totalDurationSince);
  const otherDurationMs = liveMember
    ? totalDurationMs - (liveMember.group.totalDurationMs ?? 0)
    : 0;
  const totalDurationSince = liveMember?.group.totalDurationSince
    ? new Date(Date.parse(liveMember.group.totalDurationSince) - otherDurationMs).toISOString()
    : undefined;
  const spentUsd = members.reduce((sum, member) => sum + member.group.spentUsd, 0);
  const hasTokenTotal = members.some((member) => member.group.spentTokens !== undefined);
  const spentTokens = hasTokenTotal
    ? members.reduce((sum, member) => sum + (member.group.spentTokens ?? 0), 0)
    : undefined;
  const costSettled = members.some((member) => member.group.done.length > 0);
  const states = members.map(({ group: member }) => ({
    specFolder: member.specFolder,
    implemented: member.done.includes("implement"),
    archived: isArchivedRow(member),
    acceptanceOpen: !!member.acceptanceOpen,
    busy: specBusy(member),
  }));
  const controls = executionGroupControls(group, states);
  const key = `${group.project}\n${group.name}`;
  const created = createdLabel(group.createdAt);
  const control = controls.action ? buttonForm({
    action: `/api/queue/groups/${encodeURIComponent(group.id)}/action`,
    hook: "actionform",
    hidden: { action: controls.action },
    // Primary, as a spec's own action is.
    button: {
      label: controls.action === "archive" ? stepLabel("archive", lang as never) : controls.action === "stop" ? "Stop" : "Start",
      variant: "primary",
    },
  }) : "";
  const anchor = executionGroupAnchor(group);
  const editDialogId = `edit-group-${anchor}`;
  const menuContent = controls.menu.map((item) => item === "edit"
    ? `<button type="button" data-ask="${esc(editDialogId)}">${esc(t(lang as Language, "list.groupEdit"))}</button>`
    : buttonForm({ action: `/api/queue/groups/${encodeURIComponent(group.id)}/action`, hook: "actionform", hidden: { action: "remove" }, button: { menuItem: t(lang as Language, "project.remove") } })).join("");
  const menu = headerMenu({ label: t(lang as Language, "list.groupMenu", { group: group.name }), icon: ICON_MORE, content: menuContent });
  // The card is one cell of the list holding a table of its own: the group's
  // two lines, then its members drawn exactly as on the list, each its own
  // card. A cell has one border, so the card around the specs cannot be
  // drawn on the specs' own cells.
  // Shut, unless a member's spec is open in it (the address that opens a
  // spec opens its group too) or a chosen state shows it, which the row
  // tells the page script in `data-group-open`.
  const open = !!opts.openFor || members.some((member) => member.html.includes(" data-spec-detail="));
  const shut = open ? "" : " hidden";
  // Two lines always, as a spec's card: the name, then the date with a pip
  // per member at its right, numbered in the group's order, and the state
  // or, while the card is open, its action.
  const memberPips = pips(group.members.map((folder, index) => {
    const row = members.find((member) => member.group.specFolder === folder);
    return { kind: memberPipKind(row?.group, group.completedMembers.includes(folder)), title: folder, label: String(index + 1) };
  }));
  const head = `<tbody data-group-head><tr class="grouphead">` +
    `<td class="foldcell" rowspan="2" data-col="fold">${foldButton({ label: group.name, open, data: { "group-toggle": key } })}</td>` +
    `<td colspan="5"><div class="groupheadline"><div class="spec-name">${kindIcon("group", lang as Language)}<span class="label">${projectLink(group.project, { className: "muted" })}` +
    `<span class="muted">:</span><span class="specname">${esc(group.name)}</span></span></div>${menu}</div></td></tr>` +
    `<tr class="groupline"><td colspan="2"><span class="createdpips"><span class="muted small">${esc(created)}</span>` +
    `<span class="pipslot">${memberPips}</span></span></td>` +
    `<td data-col="state"><span class="badgeslot" data-group-state${open && control ? " hidden" : ""}>${badge(groupBadgeVariant(group.state), t(lang as Language, GROUP_STATE_KEY[group.state]))}</span>` +
    (control ? `<span class="actionslot" data-group-action${open ? "" : " hidden"}>${control}</span>` : "") + `</td>` +
    `<td data-col="started">${activeDurationCell({ totalDurationMs, totalDurationSince } as SpecGroup)}</td>` +
    `<td class="num" data-col="cost">${costCell(spentUsd, spentTokens, "–", costSettled)}</td></tr>` +
    // What the group waits for, outside the body the fold hides.
    executionGroupWaitRows(group, states, lang as Language) +
    `</tbody>`;
  const memberRows = `<tbody data-group-members data-group-body${shut}>` + members.map((member) => {
    const membership = ` data-spec-group-member="${esc(key)}"`;
    return member.html.includes(" data-spec-group-member=")
      ? member.html.replace(/ data-spec-group-member="[^"]*"/, membership)
      : member.html.replace("<tr", `<tr${membership}`);
  }).join("") + `</tbody>`;
  return `<tr class="execution-group" id="${esc(anchor)}" data-spec-group="${esc(key)}"${opts.openFor ? ` data-group-open="${esc(opts.openFor)}"` : ""}>` +
    `<td class="groupcell" colspan="6"><table class="list speclist groupcard">${columnGroup()}${head}${memberRows}</table>` +
    (controls.menu.includes("edit") ? executionGroupEditor({ projects: [group.project], candidates: opts.candidates ?? [], group: {
      id: group.id, anchor, project: group.project, name: group.name,
      members: group.members.map((folder) => ({ specFolder: folder, title: members.find((row) => row.group.specFolder === folder)?.group.title, locked: opts.locked?.has(folder) ?? false })),
    }, lang: lang as Language }) : "") +
    `</td></tr>` +
    `<tr class="specgap" aria-hidden="true"><td colspan="6"></td></tr>`;
}
