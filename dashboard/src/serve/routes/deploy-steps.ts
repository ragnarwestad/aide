// The Deploy button. For the board's own project it is one request that
// queues a deploy job (the run is `serve/deploy-job/`); for every other
// project one request per step (fetch, install, restart, check), for the
// page script that draws each step's state as it happens. And the
// read-only origin check the Deploy tab makes when it is opened.

import { resolve } from "node:path";
import { fastForwardToOrigin, type RepoMergeResult } from "../../git/branch-merge.ts";
import { renderSentence, type Sentence } from "../../i18n/message.ts";
import type { Language } from "../../i18n";
import { resolveInstallCmd } from "../../project/discover";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import { DEPLOY_KEY, isDeployJob, UNFINISHED } from "../../queue/queue.ts";
import { landingJobNames } from "../land-branch";
import { DEPLOY_LOCK_WAIT_MS, json, languageChoice, logRefusal, rootFreeWithin } from "../serve-helpers";
import { STARTED_AT } from "../state.ts";
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
  /** Waits for landings in flight, then restarts the service. */
  restartDashboard: () => void;
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
const STEP_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/deploy\/(fetch|install|restart|check)$/;

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

/** The Deploy tab's own check, made when the tab is opened: a fresh count
 *  against origin and nothing else — no pull, no install, no restart, and
 *  no failure kept for the tab. An answer origin did not give keeps the last one. */
async function driftCheck(ctx: RoutesContext, name: string): Promise<Response> {
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
    return json({ ok: false, error: `"${name}" is not a project this dashboard knows` }, 400);
  }
  const root = ctx.machineryProjectDir(name);
  if (!resolveInstallCmd(root).value) {
    return json({ ok: false, error: `${name} has no ${SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase()} configured` }, 400);
  }
  const behind = await ctx.branchStatus.commitsBehindOrigin(root, true, true);
  if (behind === null) return json({ ok: false, error: `origin could not be checked for ${name}` }, 400);
  return json({ ok: true, behind });
}

/** The board's own Deploy: queue the job and answer it. Every refusal is a
 *  400 with its sentence; the Deploy panel's kept failure belongs to the
 *  steps a page drives, not to a job. */
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
    return refuse(`only the board itself is deployed as a job — ${name} deploys from its own Deploy tab`);
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
  const match = path.match(STEP_ROUTE);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const name = decodeURIComponent(match[1]!);
  const step = match[2]!;
  const lang: Language = languageChoice(new URL(req.url), req).lang;
  const refuse = (error: string, extra: Record<string, unknown> = {}): Response => {
    logRefusal(`project-deploy-${step}`, name, error);
    if (ctx.allowed.has(name)) ctx.setDeployFailure(name, { step, error });
    return json({ ok: false, error, ...extra }, 400);
  };
  const sentence = (s: Sentence): string => renderSentence(lang, s) ?? "";

  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
    return refuse(`"${name}" is not a project this dashboard knows`);
  }
  // The first step of a deploy starts it afresh: the last failure is gone.
  if (step === "fetch") ctx.setDeployFailure(name, null);
  const root = ctx.machineryProjectDir(name);
  if (step !== "check" && !resolveInstallCmd(root).value) {
    return refuse(`${name} has no ${SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase()} configured — deploying stays a hand step`);
  }

  if (step === "fetch") {
    const base = await ctx.branchStatus.defaultBranch(root);
    if (!base) return refuse(`cannot work out the default branch in ${root}`);
    // A landing into this checkout holds it through its test run; waiting
    // that out left the button hanging until the browser gave up.
    if (!(await rootFreeWithin(ctx.mergeLock, root, ctx.opts.deployLockWaitMs ?? DEPLOY_LOCK_WAIT_MS))) {
      return refuse(`a spec is being merged into ${name} right now — press Deploy again once it has landed`);
    }
    const result = await ctx.mergeLock.run(root, () => fastForwardToOrigin(ctx.gitRun, root, base));
    if (!result.ok) return refuse(sentence(result.error!) || `cannot bring ${root} up to date`);
    return json({ ok: true });
  }

  if (step === "install") {
    const result: RepoMergeResult = { root, ok: true };
    await ctx.deploy.installCheckout(result);
    // Fresh, also after a failed install: the checkout has moved.
    await ctx.branchStatus.commitsBehindOrigin(root, true);
    if (!result.installError) return json({ ok: true });
    const error = sentence(result.installError);
    console.error(`queue: deploy ${name} in ${root} — ${error}`);
    const older = await servedOlder(ctx, root);
    if (typeof older === "object") {
      ctx.setDeployFault({ key: "landing.deployServiceOlder", values: older });
      return refuse(error, { faulty: true });
    }
    return refuse(error);
  }

  if (step === "restart") {
    if (!(await ctx.deploy.restartRegistered())) {
      const older = await servedOlder(ctx, root);
      if (typeof older !== "object") return json({ ok: true, restart: "none" });
      ctx.setDeployFault({ key: "landing.deployNoRestart", values: older });
      return json({ ok: true, restart: "none", faulty: true });
    }
    const jobs = landingJobNames(ctx.queue);
    if (jobs.length > 0 || ctx.mergeLock.size > 0) {
      ctx.setPendingRestart(jobs);
      const held = json({ ok: true, restart: "held" });
      ctx.deploy.restartDashboard();
      return held;
    }
    // Answered first, fired after: a restart awaited here landed before
    // the answer went out, and the page read "the request failed".
    const fired = json({ ok: true, restart: "fired", startedAt: STARTED_AT });
    ctx.deploy.restartDashboard();
    return fired;
  }

  // check: on the process that answers the page, so the origin count it
  // fills is the one the reload reads.
  await ctx.branchStatus.commitsBehindOrigin(root, true);
  const older = await servedOlder(ctx, root);
  if (typeof older === "object") {
    const fault: Sentence = { key: "landing.deployServiceOlder", values: older };
    ctx.setDeployFault(fault);
    return refuse(sentence(fault), { faulty: true });
  }
  if (older === "equal") ctx.setDeployFault(null);
  return json({ ok: true });
}
