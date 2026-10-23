// The board's own Deploy: one request that queues a deploy job (the run is
// `serve/deploy-job/`). And the read-only origin check the Deploy tab makes
// when it is opened, for every project.

import { resolve } from "node:path";
import type { RepoMergeResult } from "../../git/branch-merge.ts";
import { resolveInstallCmd } from "../../project/discover";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import { DEPLOY_KEY, isDeployJob, UNFINISHED } from "../../queue/queue.ts";
import { json, logRefusal } from "../serve-helpers";
import type { RoutesContext } from "./";

/** What a Deploy press asks of the landing code. */
export interface DeployHooks {
  /** Install, then hand the restart it may call for back as a thunk, to
   *  be fired only once the answer has been composed (the combined
   *  route). */
  installAfterMerge: (result: RepoMergeResult) => Promise<{ restart?: () => void }>;
  /** The install alone: writes `result.installError` and answers whether
   *  a restart should follow. */
  installCheckout: (result: RepoMergeResult) => Promise<boolean>;
  /** Whether anything on this machine restarts the service. */
  restartRegistered: () => Promise<boolean>;
  /** Whether `root` is the checkout the board runs from: the one project
   *  whose Deploy is a job. */
  isBoard: (root: string) => boolean;
  /** The deploy job's restart: waits for landings with no deadline, tells
   *  `onWait` which are in flight, calls `beforeFire` right before the
   *  service restarts, and answers whether it did. */
  restartWhenSettled: (o: { onWait: (landings: string[]) => void; beforeFire: () => void }) => Promise<boolean>;
}

const DEPLOY_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/deploy$/;
const DRIFT_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/drift$/;

/** The commit the dashboard's own checkout is on when the running
 *  service is on another one — for the dashboard's own project only,
 *  and only once the served commit is known (until it is, no claim). */
export async function servedOlder(
  ctx: Pick<RoutesContext, "readServing" | "gitRun">,
  root: string,
): Promise<{ served: string; head: string } | "equal" | "unknown"> {
  const { sha, repoRoot } = ctx.readServing();
  if (!sha || !repoRoot || resolve(root) !== resolve(repoRoot)) return "unknown";
  const head = await ctx.gitRun(root, ["rev-parse", "HEAD"]).catch(() => null);
  if (!head || head.code !== 0) return "unknown";
  const checkout = head.stdout.trim();
  return checkout === sha ? "equal" : { served: sha.slice(0, 7), head: checkout.slice(0, 7) };
}

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
  const running = ctx.queue.list().find((j) => j.project === name && isDeployJob(j) && UNFINISHED.has(j.state));
  if (running) return refuse(`a deploy is already ${running.state} — follow it on the Running tab`);
  const result = ctx.queue.enqueue({ project: name, specFolder: DEPLOY_KEY, steps: ["deploy"] });
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
