import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { saveSpecFiles, type SpecFileEdit } from "../../../git/specs-pull.ts";
import { specFolders } from "../../../project/discover";
import { nextGroupPosition, specGroup, withGroupLines } from "../../../project/discover/group.ts";
import { DESCRIPTION_FILE, groupBranch } from "../../../project/spec-names.ts";
import { eligibleGroupMembers, executionGroupAddRefusal, groupAddCandidates, type ExecutionGroupAddRefusal } from "../../../queue/execution-groups";
import { validateExecutionGroupRequest } from "../../../queue/execution-groups/eligibility.ts";
import { getErrorMessage } from "../../../messages/shared/written.ts";
import { bodyToObject, editMessage, json, logRefusal, readBounded, refusal } from "../../serve-helpers";
import { executionGroupForAction } from "../job-actions.ts";
import { continueAfterAdd } from "./group-continue.ts";
import type { RoutesContext } from "..";

const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

export async function handleSpecGroupRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const addTo = path.match(/^\/api\/queue\/groups\/([^/]+)\/members$/);
  if (addTo) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    return addGroupMember(ctx, req, addTo[1]!);
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

/** Why a group takes no more specs, and what to do instead. */
const ADD_REFUSED: Record<ExecutionGroupAddRefusal, (name: string) => { what: string; resolve: string }> = {
  implemented: (name) => ({
    what: `every spec in the group ${name} has finished Implement, so no spec can be added to it`,
    resolve: "press Archive on the group, then make a new group with New group",
  }),
  archiving: (name) => ({ what: `the group ${name} is being archived, so no spec can be added to it`, resolve: "make a new group with New group" }),
  completed: (name) => ({ what: `the group ${name} has been archived, so no spec can be added to it`, resolve: "make a new group with New group" }),
};

/** One spec added at the end of a group's order: its own description gets
 *  the group's lines at the last position plus one, and the group's record
 *  gets it as its last member. No other member, state or job is touched;
 *  the group's continuation and Start find it by its position. */
async function addGroupMember(ctx: RoutesContext, req: Request, rawId: string): Promise<Response> {
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  let body: Record<string, unknown>;
  try { body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>; }
  catch { return json({ error: "malformed body" }, 400); }
  let id: string;
  try { id = decodeURIComponent(rawId); } catch { return json({ error: "invalid group" }, 400); }
  const member = String(body.member ?? "");
  if (!member) return json({ error: "member is required" }, 400);
  const targets = ctx.withFreshness(ctx.targets());
  const group = executionGroupForAction(ctx.queue.executionGroups, id, targets);
  if (!group) return json({ error: "the group no longer exists" }, 409);
  const { project, name } = group;
  const refuse = (sentence: { what: string; resolve: string }): Response => {
    const said = getErrorMessage(sentence);
    logRefusal("add to group", `${project}/${member}`, said.text);
    return refusal({ error: said.problem, solution: said.solution }, { spec: `${project}/${member}` }, 409);
  };

  const states = group.members.map((folder) => {
    const target = targets.find((t) => t.project === project && t.specFolder === folder);
    return target
      ? { implemented: (target.done ?? []).includes("implement"), archived: false, acceptanceOpen: !!target.acceptanceOpen, busy: false }
      : { implemented: true, archived: true, acceptanceOpen: false, busy: false };
  });
  const refused = executionGroupAddRefusal(group, states);
  if (refused) return refuse(ADD_REFUSED[refused](name));

  const eligibility = { project, targets, groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list() };
  if (!groupAddCandidates({ ...eligibility, members: group.members }).some((t) => t.specFolder === member)) {
    const dependent = eligibleGroupMembers(eligibility).some((t) => t.specFolder === member)
      ? targets.find((t) => t.project === project && group.members.includes(t.specFolder) && (t.dependsOn ?? []).includes(member))
      : undefined;
    return refuse(dependent
      ? { what: `${dependent.specFolder} depends on ${member}, so ${member} cannot be added after it`, resolve: "choose a spec no member of the group depends on" }
      : { what: `${member} can no longer be added to the group ${name}`, resolve: "close the dialog and choose from the specs it lists now" });
  }

  const dir = ctx.specDir(project, member);
  if (!dir) return json({ error: `${member} is no longer available` }, 409);
  // Membership, position, write and record in one hold of the lock, all read
  // inside it, so two adds can neither share a position nor add one spec twice.
  const outcome = await ctx.mergeLock.run(await ctx.specsRoot(dir), async () => {
    if (specGroup(dir) || (ctx.queue.executionGroups.get(group.id) ?? group).members.includes(member)) {
      return { error: `${member} is already in a group — nothing was saved` };
    }
    let current: string;
    try { current = readFileSync(`${dir}/${DESCRIPTION_FILE}`, "utf-8"); }
    catch { return { error: `${member} could not be read — nothing was saved` }; }
    const position = nextGroupPosition(name, specFolders(dirname(dir), false).map((spec) => spec.group));
    const text = withGroupLines(current, { name, position });
    if (text === null) return { error: `${member} has no place for group membership — nothing was saved` };
    const saved = await saveSpecFiles(
      ctx.gitRun, dir, (root) => ctx.branchStatus.defaultBranch(root),
      [{ file: DESCRIPTION_FILE, text, baseSha: (await lastCommitOf(ctx.gitRun, dir, DESCRIPTION_FILE))?.sha ?? null }],
      { specLabel: name, message: editMessage(name, "execution group") },
    );
    if (!saved.ok) return { error: saved.note };
    const latest = ctx.queue.executionGroups.get(group.id) ?? group;
    return { group: ctx.queue.executionGroups.update(group.id, { members: [...latest.members, member] }) };
  });
  if ("error" in outcome) return json({ error: outcome.error }, 409);
  await ctx.rereadProject(project);
  if (continueAfterAdd(ctx.queue, group.id, member, group.state)) await ctx.tickRunner();
  ctx.notifyQueueChanged();
  return json({ ok: true, group: outcome.group });
}
