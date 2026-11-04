// "Run on <account>": a Claude step stopped on its usage limit is queued
// again at once on another login, without waiting for the limit to reset.
// The account goes onto the job, so its later Claude steps run there too,
// and the wait it leaves behind on the old login stays on the job
// (`usageLimitLeft`) so the steps nobody pressed are still held by it.

import { homedir } from "node:os";
import { DEFAULT_ACCOUNT, expandConfigDir, holdKey, runOnAccounts } from "../../../queue/runner/claude-accounts.ts";
import { bodyToObject, json, logRefusal, readBounded } from "../../serve-helpers";
import { stepTool } from "../../serve-helpers/runner-argv.ts";
import type { RoutesContext } from "../";

export async function handleRunOnRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/run-on$/);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const id = match[1]!;
  const job = ctx.queue.get(id);
  if (!job) return json({ error: "no such job" }, 404);
  const body = await readBounded(req);
  if ("refusal" in body) return body.refusal;
  let asked: Record<string, unknown>;
  try {
    asked = (bodyToObject(body.text, req.headers.get("content-type")) ?? {}) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed body" }, 400);
  }
  const spec = `${job.project}/${job.specFolder}`;
  const defaults = ctx.queue.defaults;
  const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1] ?? "";
  const tool = stepTool(job, step, defaults);
  const home = homedir();
  const offered = runOnAccounts(job, tool, defaults.claudeAccounts, home);
  if (offered.length === 0) {
    const reason = "this step is not stopped on Claude's usage limit with another account to run on";
    logRefusal("run-on", spec, reason);
    return json({ error: reason, spec }, 409);
  }
  const name = typeof asked.account === "string" ? asked.account : "";
  if (!offered.includes(name)) {
    const reason = `${name || "No account"} is not one this step can run on — pick ${offered.join(" or ")}`;
    logRefusal("run-on", spec, reason);
    return json({ error: reason, spec }, 400);
  }
  const target = name === DEFAULT_ACCOUNT
    ? undefined
    : { name, configDir: expandConfigDir(defaults.claudeAccounts![name]!.configDir, home) };
  const result = ctx.queue.transition(id, "run-on-account", {
    claudeAccount: target,
    // The old login stays held until its own reset time; waits an earlier
    // press left on other logins are kept beside it.
    ...(job.usageLimitWait && job.usageLimitLeft
      ? { usageLimitLeftBefore: [job.usageLimitLeft, ...(job.usageLimitLeftBefore ?? [])] }
      : {}),
    ...(job.usageLimitWait
      ? {
          usageLimitLeft: {
            hold: holdKey(job, tool),
            until: job.usageLimitWait.until,
            resetKnown: job.usageLimitWait.resetKnown,
            since: job.finishedAt ?? new Date().toISOString(),
          },
        }
      : {}),
    pressed: true,
    usageLimitWait: undefined,
    usageLimitProbe: undefined,
    stopReason: undefined,
    finishedAt: undefined,
    error: undefined,
    errorDetail: undefined,
    errorReason: undefined,
  });
  if (!result.ok) {
    const reason = `the job is already ${result.state}; only a step stopped on a usage limit can be moved to another account`;
    logRefusal("run-on", spec, reason);
    return json({ error: reason, spec }, 409);
  }
  await ctx.tickRunner();
  return json({ ok: true, job: ctx.queue.get(id) });
}
