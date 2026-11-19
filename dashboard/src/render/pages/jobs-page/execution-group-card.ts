import { firstWaiting } from "../../ui/job-state/waiting.ts";
import { queueBadge } from "../../ui/components/queue-editor";
import { groupProviderLimitWait } from "../../../messages/jobs/group-stop.ts";
import { automaticProviderWait, inFlight } from "../../../queue/job-rules/activity.ts";
import { currentStep } from "../../ui/job-state";
import { specNumber } from "../../../project/spec-folder.ts";
import type { ExecutionGroup } from "../../../queue/execution-groups";
import { executionGroupActivity, executionGroupControls } from "../../../queue/execution-groups";
import { esc } from "../../ui/html.ts";
import { badge, buttonForm, foldButton, headerMenu, pips, progressDialog, stepLabel, type BadgeVariant, type PipKind } from "../../ui/components";
import type { SpecGroup, SpecTarget, SpecsPageOptions } from "../specs-list";
import { isArchivedRow } from "../specs-list";
import { phaseSubRows } from "../specs-list/phase-rows.ts";
import { groupArchiveAttempts } from "../specs-list/group-archive-projection.ts";
import { specBusy } from "../specs-list/row-state.ts";
import { activeDurationCell, costCell, createdLabel, phasePipKind } from "../specs-list/cell-helpers.ts";
import { specPlace, type TabPlace } from "./rows.ts";
import { columnGroup } from "../specs-list/filter-bar.ts";
import { rowLabel } from "../../ui/components/spec-name.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { executionGroupEditor } from "./execution-group-editor.ts";
import { ICON_MORE } from "../../ui/components/icons.ts";
import { executionGroupStopRows, executionGroupWaitRows } from "./execution-group-waiting.ts";
import type { QueueRowView } from "../../ui/job-state";

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

export function executionGroupDisplayState(group: ExecutionGroup, archiveJob?: QueueRowView): ExecutionGroup["state"] {
  return group.state === "archiving" && archiveJob?.state === "queued" && !archiveJob.landing ? "queued" : group.state;
}

export function executionGroupStateLabel(group: ExecutionGroup, members: readonly ExecutionGroupMemberRow[], lang: Language, archiveJob?: QueueRowView): string {
  if (group.queuePosition) return t(lang, "list.stateQueuedPosition", { n: group.queuePosition.n, total: group.queuePosition.total });
  if (groupProviderLimitWait(group, members.map((member) => member.group))) return t(lang, "list.state.waiting");
  const lead = (group.state === "archiving" ? archiveJob : undefined) ?? members.find((member) => member.group.specFolder === group.currentMember)?.group.lead;
  const state = executionGroupDisplayState(group, lead);
  const position = state === "queued" || lead?.queuePosition?.id ? lead?.queuePosition : undefined;
  return position ? t(lang, "list.stateQueuedPosition", { n: position.n, total: position.total }) : t(lang, GROUP_STATE_KEY[state]);
}

const groupBadgeVariant = (state: ExecutionGroup["state"]): BadgeVariant => {
  if (state === "running" || state === "archiving") return "running";
  if (state === "stopped" || state === "waiting-acceptance") return "waiting";
  if (state === "completed") return "done";
  return state === "prepared" ? "ready" : "idle";
};

/** A member's pip, in the colour its own badge has: done, running, failed,
 *  stopped or held back, or not started. */
export function memberPipKind(member: SpecGroup | undefined, completed: boolean, job?: QueueRowView): PipKind {
  if (job && inFlight(job)) return job.state === "queued" && !job.landing ? "queued" : "now";
  if (completed || (member && isArchivedRow(member))) return "past";
  if (!member) return "todo";
  if (specBusy(member)) return member.lead?.state === "queued" && !member.lead.landing ? "queued" : "now";
  if (["failed", "cancelled", "interrupted", "archived-unlanded"].includes(member.state)) return "refused";
  const heldBack = !!member.phases.find((p) => p.step === "archive")?.heldBack;
  return member.state === "stopped" || heldBack ? "waiting" : "todo";
}

export function executionGroupMemberJob(group: Pick<ExecutionGroup, "state" | "currentMember">, folder: string, memberJob?: QueueRowView, archiveJob?: QueueRowView): QueueRowView | undefined {
  return group.state === "archiving" ? archiveJob : folder === group.currentMember ? memberJob : undefined;
}

export function memberPipLabel(folder: string, job?: QueueRowView, lang: Language = "en"): string {
  const number = specNumber(folder);
  return job && (inFlight(job) || automaticProviderWait(job)) ? `${number} ${stepLabel(currentStep(job), lang).slice(0, 1)}` : number;
}

export function executionGroupMemberPip(group: ExecutionGroup, folder: string, member?: SpecGroup, archiveJob?: QueueRowView, lang: Language = "en") {
  const job = group.state === "completed" ? archiveJob : executionGroupMemberJob(group, folder, member?.lead, archiveJob);
  if (group.state === "archiving" || group.state === "completed") return {
    kind: phasePipKind({ step: "archive", attempts: job ? [job] : [], history: {} }, group.state === "completed" ? ["archive"] : []),
    title: folder,
    label: `${specNumber(folder)} ${stepLabel("archive", lang).slice(0, 1)}`,
  };
  return { kind: memberPipKind(member, group.completedMembers.includes(folder), job), title: folder, label: memberPipLabel(folder, job, lang) };
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
  opts: { openFor?: string; candidates?: SpecTarget[]; locked?: ReadonlySet<string>; jobs?: QueueRowView[]; list?: SpecsPageOptions } = {},
): string {
  const members = group.members.map((folder) => rows.find((row) => row.group.project === group.project && row.group.specFolder === folder)).filter((row): row is ExecutionGroupMemberRow => !!row);
  const archiveChoice = opts.jobs?.filter((job) => job.executionGroupId === group.id && job.steps.includes("archive")).at(-1);
  const archiveAttempts = groupArchiveAttempts(group.id, opts.jobs ?? []);
  const archiveJob = archiveAttempts[0];
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
  const waiting = groupProviderLimitWait(group, members.map((member) => member.group));
  const states = members.map(({ group: member }) => ({
    specFolder: member.specFolder,
    implemented: member.done.includes("implement"),
    archived: isArchivedRow(member),
    acceptanceOpen: !!member.acceptanceOpen,
    busy: specBusy(member),
    automaticWaiting: waiting?.specFolder === member.specFolder,
  }));
  const controls = executionGroupControls(group, states);
  const name = group.displayName ?? group.name;
  const key = `${group.project}\n${group.name}`;
  const created = createdLabel(group.createdAt);
  const control = controls.action ? buttonForm({
    action: `/api/queue/groups/${encodeURIComponent(group.id)}/action`,
    hook: "actionform",
    hidden: { action: controls.action },
    data: { "group-default-action": controls.action, "group-label-start": t(lang as Language, "list.groupStart"), "group-label-archive": stepLabel("archive", lang as Language) },
    // Primary, as a spec's own action is.
    button: {
      label: controls.action === "archive" ? stepLabel("archive", lang as never) : controls.action === "stop" ? t(lang as Language, "list.cancel") : t(lang as Language, "list.groupStart"),
      variant: "primary",
    },
  }) : "";
  const anchor = executionGroupAnchor(group);
  const editDialogId = `edit-group-${anchor}`;
  const removeDialogId = `remove-group-${anchor}`;
  const menuContent = controls.menu.map((item) => item === "edit"
    ? `<button type="button" data-ask="${esc(editDialogId)}"${controls.disabledMenu.includes(item) ? " disabled" : ""}>${esc(t(lang as Language, "list.groupEdit"))}</button>`
    : `<button type="button" data-ask="${esc(removeDialogId)}"${controls.disabledMenu.includes(item) ? " disabled" : ""}>${esc(t(lang as Language, "project.remove"))}</button>`).join("");
  const menu = menuContent ? headerMenu({ label: t(lang as Language, "list.groupMenu", { group: name }), icon: ICON_MORE, content: menuContent }) : "";
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
  // per member at its right, labelled with its spec number, and the state
  // or, while the card is open, its action.
  const memberPips = pips(group.members.map((folder) => {
    const row = members.find((member) => member.group.specFolder === folder);
    return executionGroupMemberPip(group, folder, row?.group, archiveJob, lang as Language);
  }));
  const head = `<tbody data-group-head><tr class="grouphead">` +
    `<td class="foldcell" rowspan="2" data-col="fold">${foldButton({ label: name, open, data: { "group-toggle": key } })}</td>` +
    `<td colspan="5"><div class="groupheadline"><div class="spec-name">${rowLabel({ project: group.project, kind: "group", name, lang: lang as Language })}</div>${menu}</div></td></tr>` +
    `<tr class="groupline"><td colspan="2"><span class="createdpips"><span class="muted small">${esc(created)}</span>` +
    `<span class="pipslot">${memberPips}</span></span></td>` +
    `<td data-col="state"><span class="badgeslot" data-group-state${open && control && !group.queuePosition ? " hidden" : ""}>${(() => { const pos = group.queuePosition ?? firstWaiting([archiveJob, ...members.map(member => member.group.lead)]); return pos?.id ? queueBadge(lang as Language, pos.id, pos.n, pos.total, pos.reason) : badge(groupBadgeVariant(executionGroupDisplayState(group, archiveJob)), executionGroupStateLabel(group, members, lang as Language, archiveJob)); })()}</span>` +
    (control ? `<span class="actionslot" data-group-action${open ? "" : " hidden"}>${control}</span>` : "") + `</td>` +
    `<td data-col="started">${activeDurationCell({ totalDurationMs, totalDurationSince } as SpecGroup)}</td>` +
    `<td class="num" data-col="cost">${costCell(spentUsd, spentTokens, "–", costSettled)}</td></tr>` +
    // What the group waits for, outside the body the fold hides.
    executionGroupWaitRows(group, states, lang as Language) +
    executionGroupStopRows(group, members.map((member) => member.group), lang as Language, archiveJob) +
    `</tbody>`;
  const archiveBase = members[0]?.group;
  const archiveModel = archiveChoice?.stepModels?.archive ?? (typeof archiveChoice?.model === "string" ? archiveChoice.model : undefined) ?? group.archiveModel;
  const archiveRow = archiveBase ? phaseSubRows({
    ...archiveBase,
    executionGroupActive: false,
    lead: archiveJob,
    done: group.state === "completed" ? [...new Set([...archiveBase.done, "archive"])] : archiveBase.done.filter((step) => step !== "archive"),
    phases: [{ step: "archive", attempts: archiveAttempts, waiting: group.queuePosition, history: {}, model: archiveModel }],
  }, {
    ...(opts.list ?? { runnerAvailable: true, targets: [] }),
    executionGroups: [],
    pendingModels: archiveModel ? { [`${group.project}/${archiveBase.specFolder}`]: { archive: archiveModel } } : opts.list?.pendingModels,
    pendingProviders: group.archiveProvider ? { [`${group.project}/${archiveBase.specFolder}`]: { archive: group.archiveProvider } } : opts.list?.pendingProviders,
  }, Date.now(), { groupArchive: true })
    .replace(`<span class="phasefold">${esc(stepLabel("archive", lang as Language))}</span>`, `<span class="phasefold">${esc(t(lang as Language, "list.groupArchivePhase"))}</span>`)
    .replace("<tr", "<tr data-group-archive") : "";
  const memberRows = `<tbody data-group-members data-group-body${shut}>${archiveRow}` + members.map((member) => {
    const membership = ` data-spec-group-member="${esc(key)}"`;
    return member.html.includes(" data-spec-group-member=")
      ? member.html.replace(/ data-spec-group-member="[^"]*"/, membership)
      : member.html.replace("<tr", `<tr${membership}`);
  }).join("") + `</tbody>`;
  return `<tr class="execution-group" id="${esc(anchor)}" data-spec-group="${esc(key)}"${opts.openFor ? ` data-group-open="${esc(opts.openFor)}"` : ""}>` +
    `<td class="groupcell" colspan="6"><table class="list speclist groupcard">${columnGroup()}${head}${memberRows}</table>` +
    (controls.menu.includes("edit") ? executionGroupEditor({ projects: [group.project], candidates: opts.candidates ?? [], group: {
      id: group.id, anchor, project: group.project, name,
      members: group.members.map((folder) => ({ specFolder: folder, title: members.find((row) => row.group.specFolder === folder)?.group.title, locked: opts.locked?.has(folder) ?? false })),
    }, lang: lang as Language }) : "") +
    (controls.menu.includes("remove") ? progressDialog(lang as Language, {
      id: removeDialogId, title: t(lang as Language, "dialog.removing"),
      ask: { title: `${t(lang as Language, "project.remove")} ${name}`,
        ok: { variant: "primary", pending: t(lang as Language, "dialog.removing") },
        post: { action: `/api/queue/groups/${encodeURIComponent(group.id)}/action`, hook: "actionform", hidden: { action: "remove" } } },
    }) : "") +
    `</td></tr>` +
    `<tr class="specgap" aria-hidden="true"><td colspan="6"></td></tr>`;
}
