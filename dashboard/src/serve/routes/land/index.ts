import { LS_REMOTE_NO_MATCH, lsRemoteBranch } from "../../../git/branch-status.ts";
import { enqueueRequest } from "../../../queue/request/index.ts";
import { inFlight, jobKind, LAND_KEY } from "../../../queue/queue.ts";
import { json, logRefusal, parseBody } from "../../serve-helpers";
import type { RoutesContext } from "../";

const LAND_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/land$/;
const SAFE_BRANCH = /^(?!-)(?!.*(?:\.\.|@\{|[~^:?*\\\[]))[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

async function queueLand(ctx: RoutesContext, req: Request, project: string): Promise<Response> {
  const refuse = (error: string): Response => {
    logRefusal("project-land", project, error);
    return json({ ok: false, error }, 400);
  };
  if (!ctx.opts.projectRoot || !ctx.allowed.has(project)) return refuse(`"${project}" is not a project this dashboard knows`);
  const body = await parseBody(req);
  if (body instanceof Response) return body;
  const branch = body.branch;
  if (typeof branch !== "string" || !SAFE_BRANCH.test(branch)) return refuse("Merge needs a safe branch name");
  const root = ctx.machineryProjectDir(project);
  const base = await ctx.branchStatus.defaultBranch(root);
  if (!base) return refuse(`the default branch for ${project} could not be read`);
  if (branch === base) return refuse(`${branch} is ${project}'s default branch, so there is nothing for Merge to merge`);
  const found = await ctx.gitRun(root, lsRemoteBranch(branch));
  if (found.code === LS_REMOTE_NO_MATCH) return refuse(`origin has no branch named ${branch}`);
  if (found.code !== 0) return refuse(`origin could not be checked for branch ${branch}`);
  const running = ctx.queue.list().find((job) => job.project === project && jobKind(job) === "land" && job.branch === branch && inFlight(job));
  if (running) return refuse(`a Merge job for ${branch} is already ${running.state} in ${project}`);
  const result = enqueueRequest(ctx.queue, { project, specFolder: LAND_KEY, steps: ["land"], branch }, "manual");
  if (!result.ok) return refuse(result.error);
  await ctx.tickRunner();
  return json({ ok: true, job: result.job, message: `Queued Merge for ${branch} in ${project}.` });
}


export async function handleLandSteps(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(LAND_ROUTE);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  return queueLand(ctx, req, decodeURIComponent(match[1]!));
}
