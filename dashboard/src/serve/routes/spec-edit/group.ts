import { workflowArc } from "../../../workflow-steps.ts";
import { json, refusal } from "../../serve-helpers";
import type { RoutesContext } from "..";

export async function handleSpecGroupRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/queue\/groups\/([A-Za-z0-9._-]+)\/(.+)$/);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const project = match[1]!;
  const name = decodeURIComponent(match[2]!);
  const members = ctx.withFreshness(ctx.targets())
    .filter((target) => target.project === project && target.group?.name === name)
    .sort((a, b) => a.group!.position - b.group!.position || a.specFolder.localeCompare(b.specFolder));
  if (members.length === 0) return new Response("not found", { status: 404 });
  const member = members[0]!;
  const active = ctx.queue.list().find((job) => job.project === project && job.specFolder === member.specFolder && ["queued", "running"].includes(job.state));
  if (active) return refusal({ error: `${member.specFolder} is already ${active.state}` }, { spec: `${project}/${member.specFolder}` });
  const steps = workflowArc().map((step) => step.name).filter((step) => step !== "create" && !member.done?.includes(step));
  const made = ctx.queue.enqueue({ project, specFolder: member.specFolder, steps });
  if (!made.ok) return refusal(made, { spec: `${project}/${member.specFolder}` });
  ctx.queue.setPendingSteps(project, member.specFolder, steps);
  ctx.queue.update(made.job.id, { pressed: true });
  await ctx.tickRunner();
  return json({ ok: true, job: made.job });
}
