// The allowlist write-back and the shared Add/Remove/Settings response
// shape — pulled out of `createServer`'s closure the same way the
// earlier clusters were (spec: split serve.ts, step 6).

import { persistQueueProjects } from "../queue/queue.ts";
import type { ProjectReadiness, ProjectStep } from "../project/project-admin";
import { json, logRefusal } from "./serve-helpers";

export interface ProjectActionsContext {
  queueConfigFile: string | undefined;
  allowed: Set<string>;
}

/** Write the allowlist back to the file the server reads on the way
 *  up, so an Add or a Remove survives a restart. Derived from the
 *  live `Set` and never from a copy of the file, which is what stops
 *  two changes a millisecond apart from losing each other.
 *
 *  Never fatal: the clone already happened, and the project IS on the
 *  allowlist in this process. But it is not silent either — a change
 *  that will vanish on the next restart is exactly the thing the
 *  operator has to be told, so it comes back as a failed step with
 *  the reason in it. */
export function persistAllowlist(ctx: ProjectActionsContext, what: string): ProjectStep {
  if (!ctx.queueConfigFile) {
    return {
      step: "allowlist",
      ok: true,
      note: `${what}; this server has no --queue-config file, so the list is not saved across a restart`,
    };
  }
  const error = persistQueueProjects(ctx.queueConfigFile, [...ctx.allowed].sort());
  return error
    ? { step: "allowlist", ok: false, error: `${what}, but it could not be saved and will be lost on restart: ${error}` }
    : { step: "allowlist", ok: true };
}

/** One answer shape for both project routes — the merge route's, step
 *  for step: `results[]` with `ok = every(...)`, so the page's own
 *  `refusalText()` renders an Add refusal exactly as it renders a
 *  merge's. Every refusal reaches `serve.log` too, which is the only
 *  record left once the page has moved on. */
export function answerProjectChange(
  action: string,
  project: string,
  steps: ProjectStep[],
  /** What an Add that SUCCEEDED found out about the project it just
   *  registered (spec 138). It travels beside `results` and never
   *  inside it: `ok` says the registration completed, `canRun` says
   *  whether a run would start, and folding the second into the first
   *  would report a checkout that IS on disk as an add to retry. */
  readiness?: ProjectReadiness,
): Response {
  const ok = steps.every((s) => s.ok);
  for (const s of steps) if (s.error) logRefusal(action, project, s.error);
  return json({ ok, project, results: steps, ...(readiness ? { readiness } : {}) }, ok ? 200 : 400);
}
