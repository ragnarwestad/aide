// The Deploy button, one request per step (fetch, install, restart,
// check), for the page script that draws each step's state as it
// happens. `POST /api/queue/projects/<name>/deploy` in queue-admin.ts
// does the same work in one request for a form posted without script;
// the guard, fast-forward and install sequence is written in both places
// and `deploy-steps.test.ts` pins that they refuse alike.

import { resolve } from "node:path";
import { fastForwardToOrigin, type RepoMergeResult } from "../../git/branch-merge.ts";
import { renderSentence, type Sentence } from "../../i18n/message.ts";
import type { Language } from "../../i18n";
import { resolveInstallCmd } from "../../project/discover";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import { runningJobNames } from "../land-branch";
import { json, languageChoice, logRefusal } from "../serve-helpers";
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
  /** Waits for running jobs and landings, then restarts the service. */
  restartDashboard: () => void;
}

const STEP_ROUTE = /^\/api\/queue\/projects\/([^/]+)\/deploy\/(fetch|install|restart|check)$/;

/** The commit the dashboard's own checkout is on when the running
 *  service is on another one — for the dashboard's own project only,
 *  and only once the served commit is known (until it is, no claim). */
async function servedOlder(
  ctx: RoutesContext,
  root: string,
): Promise<{ served: string; head: string } | "equal" | "unknown"> {
  const { sha, repoRoot } = ctx.readServing();
  if (!sha || !repoRoot || resolve(root) !== resolve(repoRoot)) return "unknown";
  const head = await ctx.gitRun(root, ["rev-parse", "HEAD"]).catch(() => null);
  if (!head || head.code !== 0) return "unknown";
  const checkout = head.stdout.trim();
  return checkout === sha ? "equal" : { served: sha.slice(0, 7), head: checkout.slice(0, 7) };
}

export async function handleDeploySteps(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
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
    const jobs = runningJobNames(ctx.queue);
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
