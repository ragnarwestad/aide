// The schedule entry API routes (spec 276): create, edit, the Enabled
// toggle, Run-now, and the live cron-next preview. Modeled on
// `spec-edit.ts`'s reset route and `queue-admin.ts`'s settings route —
// refuse before any write, then either a JSON answer (script) or a
// no-JS redirect back to the list.
import { createScheduleEntry, deleteScheduleEntry, setScheduleEnabled, updateScheduleEntry } from "../../project/project-admin";
import { nextFireTime, scheduleTrackingKey } from "../../queue/schedule.ts";
import { deleteSchedulePath, projectPagePath, SCHEDULE_ROUTE } from "../../render";
import { bodyToObject, json, logRefusal, readBounded, specsRedirect } from "../serve-helpers";
import type { RoutesContext } from "./";

const CRON_NEXT_ROUTE = "/api/queue/schedule/cron-next";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Every model name the queue config lists — what a create/edit is
 *  validated against, so a name the queue would refuse at fire time is
 *  refused here instead, while a person is looking at the form. */
const knownModels = (ctx: RoutesContext): string[] => Object.keys(ctx.queue.defaults.modelChoices ?? {});

async function readJsonBody(req: Request): Promise<{ body: Record<string, unknown> } | { refusal: Response }> {
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent;
  try {
    const body = sent.text ? (bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>) : {};
    return { body };
  } catch {
    return { refusal: json({ error: "malformed body" }, 400) };
  }
}

export async function handleScheduleAdminRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  // Checked by exact path, and before the create route below: both are
  // one segment under `/api/queue/schedule/`, and only the method
  // differs — an exact match here never falls through to be read as a
  // project named "cron-next" (acceptance criteria 10, 11).
  if (path === CRON_NEXT_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const cron = url.searchParams.get("cron") ?? "";
    const next = nextFireTime(cron, new Date());
    if (!next) return json({ error: `"${cron}" is not a valid cron expression` }, 400);
    return json({ next: next.toISOString() });
  }

  const enabledPost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)\/enabled$/);
  if (enabledPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(enabledPost[1]!);
    const name = decodeURIComponent(enabledPost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readJsonBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    // No `confirm` field required, unlike the spec page's own Reset
    // route (acceptance criterion 8) — a plain `{enabled}` body is
    // never refused for missing confirmation.
    const enabled = body.enabled === "1" || body.enabled === true;
    const result = setScheduleEnabled(ctx.scheduleStore, project, name, enabled);
    const back = SCHEDULE_ROUTE;
    if (!result.ok) return wantsJson ? json({ error: result.error }, 400) : specsRedirect(body, { error: result.error }, back);
    return wantsJson ? json({ ok: true, enabled }) : specsRedirect(body, undefined, back);
  }

  const runPost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)\/run$/);
  if (runPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(runPost[1]!);
    const name = decodeURIComponent(runPost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    // A thin wrapper over the same enqueue/tick pair `refreshSchedules`
    // itself calls (acceptance criterion 9) — no new mechanism. It reads
    // the entry's own model for the same reason that tick does: "Run
    // now" is this entry firing early, not a different job, and it may
    // not quietly run on a different model than the schedule does.
    const entry = ctx.scheduleStore.list(project).find((e) => e.name === name);
    const result = ctx.queue.enqueue({
      project, specFolder: scheduleTrackingKey(name), steps: ["schedule"],
      ...(entry?.model ? { model: entry.model } : {}),
    });
    const back = SCHEDULE_ROUTE;
    if (!result.ok) {
      const error = `Run now was refused for ${project}:${name}: ${result.error}`;
      logRefusal("run now", `${project}/${name}`, result.error);
      return wantsJson ? json({ error }, 400) : specsRedirect({}, { error }, back);
    }
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect({}, undefined, back);
  }

  const deletePost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)\/delete$/);
  if (deletePost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(deletePost[1]!);
    const name = decodeURIComponent(deletePost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readJsonBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    const back = deleteSchedulePath(project, name);
    // No typed confirmation (2026-09-08): the page and the dialog both
    // ask the question in a sentence, and the press is the answer.
    const result = deleteScheduleEntry(ctx.scheduleStore, project, name);
    if (!result.ok) return wantsJson ? json({ error: result.error }, 400) : specsRedirect(body, { error: result.error }, back);
    return wantsJson ? json({ ok: true }) : specsRedirect(body, undefined, SCHEDULE_ROUTE);
  }

  const editPost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)$/);
  if (editPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(editPost[1]!);
    const name = decodeURIComponent(editPost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readJsonBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    const result = updateScheduleEntry(ctx.scheduleStore, project, ctx.machineryProjectDir(project), name, {
      name: str(body.name), cron: str(body.cron), prompt: str(body.prompt), model: str(body.model),
    }, knownModels(ctx));
    const back = SCHEDULE_ROUTE;
    if (!result.ok) return wantsJson ? json({ error: result.error }, 400) : specsRedirect(body, { error: result.error }, back);
    return wantsJson ? json({ ok: true }) : specsRedirect(body, undefined, back);
  }

  // Project-agnostic, like `/api/queue/create` (spec 278): no
  // per-resource segment left to key on, so the route validates the
  // body's own `project` claim against the allowlist instead of a URL
  // segment — same `ctx.allowed.has(project)` guard every other route
  // in this file already runs, checked before any read or write.
  if (path === "/api/queue/schedule") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const sent = await readJsonBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    const project = str(body.project);
    // The form that posts here now lives on the project's own Schedule
    // tab, not the aggregate page (spec 468) — a no-JS redirect, on
    // every refusal including this allowlist check, has to land back
    // where the form is (3-solution.md, Risk 2: a project outside the
    // allowlist still gets the form, and its refusal surfaces through
    // the same error line a bad cron or a duplicate name already uses).
    const back = `${projectPagePath(project)}?tab=schedule`;
    if (!ctx.allowed.has(project)) {
      const message = `"${project}" is not a project this dashboard knows`;
      return wantsJson ? json({ error: message }, 400) : specsRedirect(body, { error: message }, back);
    }
    const result = createScheduleEntry(ctx.scheduleStore, project, ctx.machineryProjectDir(project), {
      name: str(body.name), cron: str(body.cron), prompt: str(body.prompt), model: str(body.model),
    }, knownModels(ctx));
    if (!result.ok) return wantsJson ? json({ error: result.error }, 400) : specsRedirect(body, { error: result.error }, back);
    return wantsJson ? json({ ok: true }) : specsRedirect(body, undefined, back);
  }

  return null;
}
