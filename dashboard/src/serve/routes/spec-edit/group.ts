import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { saveSpecFiles, type SpecFileEdit } from "../../../git/specs-pull.ts";
import { withGroupLines } from "../../../project/discover/group.ts";
import { DESCRIPTION_FILE, groupBranch } from "../../../project/spec-names.ts";
import { validateExecutionGroupRequest } from "../../../queue/execution-groups/eligibility.ts";
import { bodyToObject, editMessage, json, readBounded } from "../../serve-helpers";
import type { RoutesContext } from "..";

const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

export async function handleSpecGroupRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
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
