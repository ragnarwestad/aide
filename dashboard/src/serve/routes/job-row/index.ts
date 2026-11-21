// Remove and Start on a job's row on Jobs. Each is allowed only where the
// row offers it (`queue/job-rules/job-actions.ts`), so the page and this
// route cannot disagree.

import { LS_REMOTE_NO_MATCH, lsRemoteBranch } from "../../../git/branch-status.ts";
import { offers } from "../../../queue/job-rules/job-actions.ts";
import { jobKind } from "../../../queue/queue.ts";
import { json, logRefusal, readBounded } from "../../serve-helpers";
import type { RoutesContext } from "../";

export async function handleJobRowAction(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const rowAction = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/(remove|restart)$/);
  if (!rowAction) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const [, id, verb] = rowAction;
  const job = ctx.queue.get(id!);
  if (!job) return json({ error: "no such job" }, 404);
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  const spec = `${job.project}/${job.specFolder}`;
  const branchGone = jobKind(job) === "land" && (job.state === "failed" || job.state === "cancelled") && job.branch
    ? await branchGoneFromOrigin(ctx, job.project, job.branch)
    : undefined;
  const action = verb === "remove" ? "remove" : "start";
  if (!offers({ ...job, branchGone }, action)) {
    const reason = branchGone && action === "start"
      ? `origin no longer has branch ${job.branch}, so there is nothing to merge`
      : `this job does not offer ${verb === "remove" ? "Remove" : "Start"} when it is ${job.state}`;
    logRefusal(verb!, spec, reason);
    // No `spec`: these rows are not a spec's, so the page writes the
    // reason in the line above the list rather than under a spec row.
    return json({ error: reason }, 409);
  }
  if (action === "remove") {
    ctx.queue.update(job.id, { removedAt: new Date().toISOString() });
    return json({ ok: true, job: ctx.queue.get(job.id) });
  }
  const result = ctx.queue.transition(job.id, "restart", {
    stepIndex: 0, startedAt: undefined, stepStartedAt: undefined, finishedAt: undefined,
    error: undefined, errorDetail: undefined, errorReason: undefined, stopReason: undefined,
    landingError: undefined, branchDeleteError: undefined, landPushStarted: undefined,
  });
  if (!result.ok) return json({ error: `the job is ${result.state} and cannot be started again` }, 409);
  await ctx.tickRunner();
  return json({ ok: true, job: result.job });
}

/** Whether origin no longer has `branch`. Only git's own "no such ref"
 *  counts: an origin that cannot be reached says nothing about it. */
async function branchGoneFromOrigin(ctx: RoutesContext, project: string, branch: string): Promise<boolean> {
  const found = await ctx.gitRun(ctx.machineryProjectDir(project), lsRemoteBranch(branch));
  return found.code === LS_REMOTE_NO_MATCH;
}
