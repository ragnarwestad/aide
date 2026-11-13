import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { saveSpecFiles, type SpecFileEdit } from "../../../git/specs-pull.ts";
import { withGroupLines } from "../../../project/discover/group.ts";
import { DESCRIPTION_FILE, groupBranch } from "../../../project/spec-names.ts";
import { lockedGroupMembers, validateExecutionGroupEdit, validateExecutionGroupRequest } from "../../../queue/execution-groups";
import { bodyToObject, editMessage, json, readBounded } from "../../serve-helpers";
import { executionGroupForAction } from "../job-actions.ts";
import { continueAfterEdit } from "./group-continue.ts";
import type { RoutesContext } from "..";

const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

export async function handleSpecGroupRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const edit = path.match(/^\/api\/queue\/groups\/([^/]+)$/);
  if (edit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    return editGroup(ctx, req, edit[1]!);
  }
  if (path !== "/api/queue/groups") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  let body: Record<string, unknown>;
  try { body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>; }
  catch { return json({ error: "malformed body" }, 400); }
  const targets = ctx.withFreshness(ctx.targets());
  const project = String(body.project ?? "");
  const name = String(body.name ?? "").trim();
  if (!project || !name) return json({ error: "project and name are required" }, 400);
  if (ctx.queue.executionGroups.findUnfinished(project, name) ||
    targets.some((target) => target.project === project && target.group?.name === name)) {
    return json({ error: `an unfinished execution group named ${name} already exists` }, 409);
  }
  const checked = validateExecutionGroupRequest({
    project, members: values(body.member), positions: values(body.position).map(Number), targets,
    groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list(),
  });
  if (!checked.ok) return json({ error: checked.error }, 409);

  const firstDir = ctx.specDir(project, checked.members[0]!);
  if (!firstDir) return json({ error: `${checked.members[0]} is no longer available` }, 409);
  const edits: SpecFileEdit[] = [];
  for (const [index, folder] of checked.members.entries()) {
    const dir = ctx.specDir(project, folder);
    if (!dir) return json({ error: `${folder} is no longer available` }, 409);
    let current: string;
    try { current = readFileSync(`${dir}/${DESCRIPTION_FILE}`, "utf-8"); }
    catch { return json({ error: `${folder} could not be read — nothing was saved` }, 409); }
    const text = withGroupLines(current, { name, position: index + 1 });
    if (text === null) return json({ error: `${folder} has no place for group membership — nothing was saved` }, 409);
    const file = relative(firstDir, `${dir}/${DESCRIPTION_FILE}`);
    edits.push({ file, text, baseSha: (await lastCommitOf(ctx.gitRun, firstDir, file))?.sha ?? null });
  }
  const saved = await ctx.mergeLock.run(await ctx.specsRoot(firstDir), () => saveSpecFiles(
    ctx.gitRun, firstDir, (root) => ctx.branchStatus.defaultBranch(root), edits,
    { specLabel: name, message: editMessage(name, "execution group") },
  ));
  if (!saved.ok) return json({ error: saved.note }, 409);
  const branch = groupBranch(checked.members[0]!, name);
  const group = ctx.queue.executionGroups.create({ project, name, members: checked.members, branch });
  await ctx.rereadProject(project);
  ctx.notifyQueueChanged();
  return json({ ok: true, group });
}

async function editGroup(ctx: RoutesContext, req: Request, rawId: string): Promise<Response> {
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  let body: Record<string, unknown>;
  try { body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>; }
  catch { return json({ error: "malformed body" }, 400); }
  let id: string;
  try { id = decodeURIComponent(rawId); } catch { return json({ error: "invalid group" }, 400); }
  const name = String(body.name ?? "").trim();
  if (!name) return json({ error: "name is required" }, 400);
  const targets = ctx.withFreshness(ctx.targets());
  const group = executionGroupForAction(ctx.queue.executionGroups, id, targets);
  if (!group) return json({ error: "the group no longer exists" }, 409);
  const project = group.project;
  if (group.state === "archiving" || group.state === "completed") return json({ error: `the group ${group.name} cannot be edited while it is ${group.state}` }, 409);
  if (name !== group.name && (ctx.queue.executionGroups.findUnfinished(project, name) || targets.some((target) => target.project === project && target.group?.name === name && !group.members.includes(target.specFolder)))) {
    return json({ error: `an unfinished execution group named ${name} already exists` }, 409);
  }
  const requested = values(body.member);
  const positions = values(body.position).map(Number);
  const locks = lockedGroupMembers({ group, targets, jobs: ctx.queue.list() });
  if (locks.size && name !== group.name) return json({ error: `the group name cannot change while ${[...locks][0]} is locked` }, 409);
  const checked = validateExecutionGroupEdit({ project, group, members: requested, positions, locked: locks, targets, groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list() });
  if (!checked.ok) return json({ error: checked.error }, 409);
  const firstDir = ctx.specDir(project, group.members[0]!);
  if (!firstDir) return json({ error: `${group.members[0]} is no longer available` }, 409);
  const outcome = await ctx.mergeLock.run(await ctx.specsRoot(firstDir), async () => {
    const latest = ctx.queue.executionGroups.get(group.id) ?? group;
    const freshTargets = ctx.withFreshness(ctx.targets());
    const freshLocks = lockedGroupMembers({ group: latest, targets: freshTargets, jobs: ctx.queue.list() });
    const rechecked = validateExecutionGroupEdit({ project, group: latest, members: requested, positions, locked: freshLocks, targets: freshTargets, groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list() });
    if (!rechecked.ok) return { error: rechecked.error };
    if (freshLocks.size && name !== latest.name) return { error: `the group name cannot change while ${[...freshLocks][0]} is locked` };
    const edits: SpecFileEdit[] = [];
    const involved = new Set([...latest.members, ...rechecked.members]);
    for (const folder of involved) {
      if (freshLocks.has(folder)) continue;
      const dir = ctx.specDir(project, folder);
      if (!dir) return { error: `${folder} is no longer available` };
      let current: string;
      try { current = readFileSync(`${dir}/${DESCRIPTION_FILE}`, "utf-8"); }
      catch { return { error: `${folder} could not be read — nothing was saved` }; }
      const position = rechecked.members.indexOf(folder);
      const text = withGroupLines(current, position < 0 ? undefined : { name, position: position + 1 });
      if (text === null) return { error: `${folder} has no place for group membership — nothing was saved` };
      if (text !== current) {
        const file = relative(firstDir, `${dir}/${DESCRIPTION_FILE}`);
        edits.push({ file, text, baseSha: (await lastCommitOf(ctx.gitRun, firstDir, file))?.sha ?? null });
      }
    }
    if (edits.length) {
      const saved = await saveSpecFiles(ctx.gitRun, firstDir, (root) => ctx.branchStatus.defaultBranch(root), edits, { specLabel: name, message: editMessage(name, "execution group") });
      if (!saved.ok) return { error: saved.note };
    }
    return { group: ctx.queue.executionGroups.update(group.id, { name, members: rechecked.members }) };
  });
  if ("error" in outcome) return json({ error: outcome.error }, 409);
  await ctx.rereadProject(project);
  if (continueAfterEdit(ctx.queue, group.id, group.state)) await ctx.tickRunner();
  ctx.notifyQueueChanged();
  return json({ ok: true, group: outcome.group });
}
