import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { saveSpecFiles, type SpecFileEdit } from "../../../git/specs-pull/index.ts";
import { withGroupLines, stripGroupLines } from "../../../project/discover/group.ts";
import { DESCRIPTION_FILE, groupBranch } from "../../../project/spec-names.ts";
import { canEditExecutionGroup, canRemoveExecutionGroup } from "../../../queue/execution-groups/actions.ts";
import { inFlight } from "../../../queue/job-rules/activity.ts";
import { lockedGroupMembers, validateExecutionGroupEdit, validateExecutionGroupRequest } from "../../../queue/execution-groups";
import { editMessage, json, readObjectBody } from "../../serve-helpers";
import { executionGroupForAction } from "./execution-group-action.ts";
import { continueOnceSpecsScanned } from "./group-continue.ts";
import type { RoutesContext } from "..";

const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

export async function createExecutionGroup(
  ctx: RoutesContext,
  input: { project: string; name: string; members: string[]; positions?: number[]; lead?: string; sharedChoices?: boolean },
): Promise<{ ok: true; group: ReturnType<RoutesContext["queue"]["executionGroups"]["create"]> } | { ok: false; response: Response }> {
  const { project, name } = input;
  const targets = ctx.withFreshness(ctx.targets());
  if (ctx.queue.executionGroups.findUnfinished(project, name) ||
    targets.some((target) => target.project === project && target.group?.name === name)) {
    return { ok: false, response: json({ error: `an unfinished execution group named ${name} already exists` }, 409) };
  }
  const checked = validateExecutionGroupRequest({
    project, members: input.members, positions: input.positions, lead: input.lead, targets,
    groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list(),
  });
  if (!checked.ok) return { ok: false, response: json({ error: checked.error }, 409) };
  const firstDir = ctx.specDir(project, checked.members[0]!);
  if (!firstDir) return { ok: false, response: json({ error: `${checked.members[0]} is no longer available` }, 409) };
  const edits: SpecFileEdit[] = [];
  for (const [index, folder] of checked.members.entries()) {
    const dir = ctx.specDir(project, folder);
    if (!dir) return { ok: false, response: json({ error: `${folder} is no longer available` }, 409) };
    let current: string;
    try { current = readFileSync(`${dir}/${DESCRIPTION_FILE}`, "utf-8"); }
    catch { return { ok: false, response: json({ error: `${folder} could not be read — nothing was saved` }, 409) }; }
    const text = withGroupLines(current, { name, position: index + 1 });
    if (text === null) return { ok: false, response: json({ error: `${folder} has no place for group membership — nothing was saved` }, 409) };
    const file = relative(firstDir, `${dir}/${DESCRIPTION_FILE}`);
    edits.push({ file, text, baseSha: (await lastCommitOf(ctx.gitRun, firstDir, file))?.sha ?? null });
  }
  const saved = await ctx.mergeLock.run(await ctx.specsRoot(firstDir), () => saveSpecFiles(
    ctx.gitRun, firstDir, (root) => ctx.branchStatus.defaultBranch(root), edits,
    { specLabel: name, message: editMessage(name, "execution group") },
  ));
  if (!saved.ok) return { ok: false, response: json({ error: saved.note }, 409) };
  const group = ctx.queue.executionGroups.create({
    project, name, members: checked.members, branch: groupBranch(checked.members[0]!, name), sharedChoices: input.sharedChoices,
  });
  await ctx.rereadProject(project);
  ctx.notifyQueueChanged();
  return { ok: true, group };
}

export async function handleSpecGroupRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const edit = path.match(/^\/api\/queue\/groups\/([^/]+)$/);
  if (edit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    return editGroup(ctx, req, edit[1]!);
  }
  if (path !== "/api/queue/groups") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const body = sent.body;
  const project = String(body.project ?? "");
  const name = String(body.name ?? "").trim();
  if (!project || !name) return json({ error: "project and name are required" }, 400);
  const made = await createExecutionGroup(ctx, { project, name, members: values(body.member), positions: body.position === undefined ? undefined : values(body.position).map(Number) });
  return made.ok ? json({ ok: true, group: made.group }) : made.response;
}

export async function editGroup(ctx: RoutesContext, req: Request, rawId: string): Promise<Response> {
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const body = sent.body;
  let id: string;
  try { id = decodeURIComponent(rawId); } catch { return json({ error: "invalid group" }, 400); }
  const name = String(body.name ?? "").trim();
  if (!name) return json({ error: "name is required" }, 400);
  const targets = ctx.withFreshness(ctx.targets());
  const group = executionGroupForAction(ctx.queue.executionGroups, id, targets);
  if (!group) return json({ error: "the group no longer exists" }, 409);
  const project = group.project;
  const canEdit = () => {
    const latest = ctx.queue.executionGroups.get(group.id) ?? group;
    const busy = ctx.queue.list().some((job) => job.project === group.project &&
      (job.executionGroupId === group.id || latest.members.includes(job.specFolder)) && inFlight(job));
    return !latest.removedAt && canEditExecutionGroup(latest, busy);
  };
  if (!canEdit()) return json({ error: `the group ${group.name} cannot be edited while it is ${group.state}` }, 409);
  const conflict = ctx.queue.executionGroups.findUnfinished(project, name);
  if ((conflict && conflict.id !== group.id) || targets.some((target) => target.project === project && target.group?.name === name && !group.members.includes(target.specFolder))) {
    return json({ error: `an unfinished execution group named ${name} already exists` }, 409);
  }
  const requested = values(body.member);
  const positions = body.position === undefined ? undefined : values(body.position).map(Number);
  const locks = lockedGroupMembers({ group, targets, jobs: ctx.queue.list() });
  const checked = validateExecutionGroupEdit({ project, group, members: requested, positions, locked: locks, targets, groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list() });
  if (!checked.ok) return json({ error: checked.error }, 409);
  const firstDir = ctx.specDir(project, group.members[0]!);
  if (!firstDir) return json({ error: `${group.members[0]} is no longer available` }, 409);
  const outcome = await ctx.mergeLock.run(await ctx.specsRoot(firstDir), () =>
    saveGroupEdit(ctx, { group, name, requested, positions, firstDir, canEdit }));
  if ("error" in outcome) return json({ error: outcome.error }, 409);
  await ctx.rereadProject(project);
  const done = (folder: string) => ctx.targets().find((t) => t.project === project && t.specFolder === folder)?.done ?? [];
  await continueOnceSpecsScanned(ctx, group.id, group.state, done);
  ctx.notifyQueueChanged();
  return json({ ok: true, group: outcome.group });
}


type ExecutionGroup = NonNullable<ReturnType<typeof executionGroupForAction>>;

/** The edit, checked again and written under the specs root's lock: the
 *  members' description files rewritten for the group's new membership,
 *  and the group updated once they are saved. */
async function saveGroupEdit(
  ctx: RoutesContext,
  edit: {
    group: ExecutionGroup;
    name: string;
    requested: string[];
    positions: number[] | undefined;
    firstDir: string;
    canEdit: () => boolean;
  },
): Promise<{ error: string } | { group: ReturnType<RoutesContext["queue"]["executionGroups"]["update"]> }> {
  const { group, name, requested, positions, firstDir, canEdit } = edit;
  const project = group.project;
  if (!canEdit()) return { error: "stop the group before editing it" };
  const latest = ctx.queue.executionGroups.get(group.id) ?? group;
  const conflict = ctx.queue.executionGroups.findUnfinished(project, name);
  if (conflict && conflict.id !== latest.id) return { error: `an unfinished execution group named ${name} already exists` };
  const freshTargets = ctx.withFreshness(ctx.targets());
  const freshLocks = lockedGroupMembers({ group: latest, targets: freshTargets, jobs: ctx.queue.list() });
  const rechecked = validateExecutionGroupEdit({ project, group: latest, members: requested, positions, locked: freshLocks, targets: freshTargets, groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list() });
  if (!rechecked.ok) return { error: rechecked.error };
  const involved = new Set([...latest.members, ...rechecked.members]);
  const edits = await memberEdits(ctx, project, firstDir, [...involved].filter((folder) => !freshLocks.has(folder)), rechecked.members, latest.name);
  if ("error" in edits) return edits;
  if (!canEdit()) return { error: "stop the group before editing it" };
  if (edits.list.length) {
    const saved = await saveSpecFiles(ctx.gitRun, firstDir, (root) => ctx.branchStatus.defaultBranch(root), edits.list, { specLabel: name, message: editMessage(name, "execution group") });
    if (!saved.ok) return { error: saved.note };
  }
  return { group: ctx.queue.executionGroups.update(group.id, { displayName: name === latest.name ? undefined : name, members: rechecked.members }) };
}

/** Each folder's description with its group lines set to its place among
 *  `members`, or taken out when it is not one; only the files that change. */
async function memberEdits(
  ctx: RoutesContext,
  project: string,
  firstDir: string,
  folders: string[],
  members: string[],
  groupName: string,
): Promise<{ error: string } | { list: SpecFileEdit[] }> {
  const list: SpecFileEdit[] = [];
  for (const folder of folders) {
    const dir = ctx.specDir(project, folder);
    if (!dir) return { error: `${folder} is no longer available` };
    let current: string;
    try { current = readFileSync(`${dir}/${DESCRIPTION_FILE}`, "utf-8"); }
    catch { return { error: `${folder} could not be read — nothing was saved` }; }
    const position = members.indexOf(folder);
    const text = withGroupLines(current, position < 0 ? undefined : { name: groupName, position: position + 1 });
    if (text === null) return { error: `${folder} has no place for group membership — nothing was saved` };
    if (text === current) continue;
    const file = relative(firstDir, `${dir}/${DESCRIPTION_FILE}`);
    list.push({ file, text, baseSha: (await lastCommitOf(ctx.gitRun, firstDir, file))?.sha ?? null });
  }
  return { list };
}

export async function removeExecutionGroup(ctx: RoutesContext, id: string): Promise<Response> {
  const group = executionGroupForAction(ctx.queue.executionGroups, id, ctx.withFreshness(ctx.targets()));
  if (!group || group.removedAt) return json({ error: "the group no longer exists" }, 409);
  const canRemove = () => {
    const latest = ctx.queue.executionGroups.get(group.id)!;
    const busy = ctx.queue.list().some((job) => job.project === group.project &&
      (job.executionGroupId === group.id || group.members.includes(job.specFolder)) && inFlight(job));
    return canRemoveExecutionGroup(latest, busy);
  };
  if (!canRemove()) return json({ error: "stop the group before removing it" }, 409);
  if (group.state !== "completed") {
    const dirs = group.members.flatMap((folder) => {
      const dir = ctx.specDir(group.project, folder);
      return dir && !ctx.specRef(group.project, folder)?.archived ? [dir] : [];
    });
    const first = dirs[0];
    if (first) {
      const result = await ctx.mergeLock.run(await ctx.specsRoot(first), async () => {
        if (!canRemove()) return { ok: false, note: "stop the group before removing it" };
        const edits: SpecFileEdit[] = [];
        for (const dir of dirs) {
          const file = relative(first, `${dir}/${DESCRIPTION_FILE}`);
          const current = readFileSync(`${dir}/${DESCRIPTION_FILE}`, "utf-8");
          const text = stripGroupLines(current);
          if (text !== current) edits.push({ file, text, baseSha: (await lastCommitOf(ctx.gitRun, first, file))?.sha ?? null });
        }
        if (!canRemove()) return { ok: false, note: "stop the group before removing it" };
        return edits.length ? saveSpecFiles(ctx.gitRun, first, (root) => ctx.branchStatus.defaultBranch(root), edits,
          { specLabel: group.name, message: editMessage(group.name, "execution group removal") }) : { ok: true };
      });
      if (!result.ok) return json({ error: result.note }, 409);
    }
  }
  const removed = ctx.queue.executionGroups.remove(group.id);
  await ctx.rereadProject(group.project);
  ctx.notifyQueueChanged();
  return json({ ok: true, group: removed });
}
