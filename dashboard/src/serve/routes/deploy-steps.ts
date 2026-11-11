// The board's own Deploy: one request that queues a deploy job (the run is
// `serve/deploy-job/`). And the read-only origin check the Deploy tab makes
// when it is opened, for every project.

import { resolveInstallCmd } from "../../project/discover";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import { DEPLOY_KEY, jobKind, inFlight } from "../../queue/queue.ts";
import { json, logRefusal } from "../serve-helpers";
import type { RoutesContext } from "./";
import { enqueueRequest } from "../../queue/request/index.ts";

/** What a Deploy press asks of the landing code. */
const DEPLOY_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/deploy$/;
const DRIFT_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/drift$/;

/** The commit the dashboard's own checkout is on when the running
 *  service is on another one — for the dashboard's own project only,
 *  and only once the served commit is known (until it is, no claim). */
/** The Deploy tab's own check, made when the tab is opened, for every
 *  project: a fresh count against origin and nothing else — no pull, no
 *  install, no restart, and no failure kept for the tab. An answer origin
 *  did not give keeps the last one. */
async function driftCheck(ctx: RoutesContext, name: string): Promise<Response> {
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
    return json({ ok: false, error: `"${name}" is not a project this dashboard knows` }, 400);
  }
  const root = ctx.machineryProjectDir(name);
  const behind = await ctx.branchStatus.commitsBehindOrigin(root, true, true);
  if (behind === null) return json({ ok: false, error: `origin could not be checked for ${name}` }, 400);
  return json({ ok: true, behind });
}

/** The board's own Deploy: queue the job and answer it. Every refusal is a
 *  400 with its sentence. */
async function queueDeploy(ctx: RoutesContext, name: string): Promise<Response> {
  const refuse = (error: string): Response => {
    logRefusal("project-deploy", name, error);
    return json({ ok: false, error }, 400);
  };
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
    return refuse(`"${name}" is not a project this dashboard knows`);
  }
  const root = ctx.machineryProjectDir(name);
  if (!resolveInstallCmd(root).value) {
    return refuse(`${name} has no ${SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase()} configured — deploying stays a hand step`);
  }
  if (!ctx.deploy.isBoard(root)) {
    return refuse(`only the board itself is deployed as a job — Deploy is not offered for ${name}`);
  }
  // A job nothing starts would sit queued for ever.
  if (!(ctx.opts.runnerAvailable ?? ctx.runner !== null)) {
    return refuse("this board has no runner, so a deploy job would never start");
  }
  const running = ctx.queue.list().find((j) => j.project === name && jobKind(j) === "deploy" && inFlight(j));
  if (running) return refuse(`a deploy is already ${running.state} — follow it on the Running tab`);
  const result = enqueueRequest(ctx.queue, { project: name, specFolder: DEPLOY_KEY, steps: ["deploy"] }, "manual");
  if (!result.ok) return refuse(result.error);
  await ctx.tickRunner();
  return json({ ok: true, job: result.job });
}

export async function handleDeploySteps(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const queue = path.match(DEPLOY_ROUTE);
  if (queue) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    return queueDeploy(ctx, decodeURIComponent(queue[1]!));
  }
  const drift = path.match(DRIFT_ROUTE);
  if (drift) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    return driftCheck(ctx, decodeURIComponent(drift[1]!));
  }
  return null;
}
