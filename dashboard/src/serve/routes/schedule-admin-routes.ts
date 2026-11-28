import { jobKind } from "../../queue/queue.ts";
import { automaticProviderWait } from "../../queue/job-rules/activity.ts";
import { scheduleTrackingKey } from "../../project/spec-names.ts";
// The schedule entry API routes: create, edit, the Enabled
// toggle, Run-now, and the live cron-next preview. Modeled on
// `spec-edit.ts`'s reset route and `queue-admin.ts`'s settings route —
// refuse before any write, then a JSON answer. A saved create or edit
// names the page the reader came from, for the page script to go to.
import { createScheduleEntry, deleteScheduleEntry, sandboxChoiceError, setScheduleEnabled, updateScheduleEntry } from "../../project/project-admin";
import { listedModelName } from "../../queue/model-name.ts";
import { nextFireTime, scheduleRequest } from "../../queue/schedule.ts";
import { enqueueRequest } from "../../queue/request/index.ts";
import { providerModelError } from "../../queue/providers/parse.ts";
import { json, logRefusal, readObjectBody, refusal } from "../serve-helpers";
import type { RoutesContext } from "./";
import { projectScheduleTab, renamedBack, scheduleBackPath } from "./page-routes/schedule-edit-page.ts";

const CRON_NEXT_ROUTE = "/api/queue/schedule/cron-next";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Every model name the queue config lists — what a create/edit is
 *  validated against, so a name the queue would refuse at fire time is
 *  refused here instead, while a person is looking at the form. */
const knownModels = (ctx: RoutesContext): string[] => Object.keys(ctx.queue.defaults.modelChoices ?? {});
const knownProviders = (ctx: RoutesContext): string[] => Object.keys(ctx.queue.defaults.providers ?? {});

/** The refusal a scheduled fire would give when the entry's AI cannot
 *  run its model, given at the save instead. */
function pairRefusal(ctx: RoutesContext, provider: string | undefined, model: string): Response | null {
  if (!provider || !model.trim() || !ctx.queue.defaults.providers?.[provider]) return null;
  const refused = providerModelError(ctx.queue.defaults, provider, model.trim());
  return refused ? refusal({ error: refused.error, solution: refused.solution }) : null;
}

/** The refusal a sandbox-off save gets when its run would not be on
 *  Claude: the posted model's tool, or, with none posted, the tool of the
 *  model the schedule step falls back to. `keptOff` is what an edit that
 *  posts no choice keeps. */
function sandboxRefusal(ctx: RoutesContext, body: Record<string, unknown>, keptOff = false): Response | null {
  const posted = str(body.sandbox).trim();
  if (!(posted === "off" || (!posted && keptOff))) return null;
  const { model = {}, modelChoices = {} } = ctx.queue.defaults;
  const asked = str(body.model).trim();
  const listed = asked ? listedModelName(Object.keys(modelChoices), asked) : undefined;
  const name = listed && "name" in listed ? listed.name : asked || model.schedule || model.default;
  const refused = sandboxChoiceError(false, (name ? modelChoices[name]?.tool : undefined) ?? "claude");
  return refused ? refusal({ error: refused, solution: "Choose a Claude Code model, or set Sandbox to On." }) : null;
}

async function scheduleRoute(_ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {
  // Checked by exact path, and before the create route below: both are
  // one segment under `/api/queue/schedule/`, and only the method
  // differs — an exact match here never falls through to be read as a
  // project named "cron-next".
  if (path === CRON_NEXT_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const cron = url.searchParams.get("cron") ?? "";
    const next = nextFireTime(cron, new Date());
    if (!next) return json({ error: `"${cron}" is not a valid cron expression` }, 400);
    return json({ next: next.toISOString() });
  }
  return null;
}

async function scheduleEnabledRoute(ctx: RoutesContext, req: Request, _url: URL, path: string): Promise<Response | null> {

  const enabledPost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)\/enabled$/);
  if (enabledPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(enabledPost[1]!);
    const name = decodeURIComponent(enabledPost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    // No `confirm` field required, unlike the spec page's own Reset
    // route — a plain `{enabled}` body is
    // never refused for missing confirmation.
    const enabled = body.enabled === "1" || body.enabled === true;
    const result = setScheduleEnabled(ctx.scheduleStore, project, name, enabled);
    if (!result.ok) return refusal({ error: result.error });
    return json({ ok: true, enabled });
  }
  return null;
}

async function scheduleRunRoute(ctx: RoutesContext, req: Request, _url: URL, path: string): Promise<Response | null> {

  const runPost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)\/run$/);
  if (runPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(runPost[1]!);
    const name = decodeURIComponent(runPost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    const entry = ctx.scheduleStore.list(project).find((e) => e.name === name);
    if (!entry) return json({ error: "the scheduled job no longer exists" }, 400);
    if (body.sourceJobId !== undefined) {
      const source = typeof body.sourceJobId === "string" ? ctx.queue.get(body.sourceJobId) : undefined;
      if (!source || source.project !== project || source.specFolder !== scheduleTrackingKey(name) ||
          jobKind(source) !== "schedule" || source.landing || automaticProviderWait(source) ||
          !["cancelled", "failed"].includes(source.state)) {
        return json({ error: "this attempt cannot be run again" }, 400);
      }
    }
    for (const field of ["model", "provider"] as const) {
      if (body[field] !== undefined && (typeof body[field] !== "string" || !body[field].trim())) {
        return json({ error: `invalid ${field} selection` }, 400);
      }
    }
    const request = scheduleRequest(project, entry);
    if (body.model !== undefined) request.model = body.model;
    if (body.provider !== undefined) request.provider = body.provider;
    const result = enqueueRequest(ctx.queue, request, "manual");
    if (!result.ok) {
      logRefusal("run now", `${project}/${name}`, result.error);
      return refusal({
        error: `Run now was refused for ${project}:${name}: ${result.error}`,
        solution: result.solution,
      });
    }
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
  }
  return null;
}

async function scheduleDeleteRoute(ctx: RoutesContext, req: Request, _url: URL, path: string): Promise<Response | null> {

  const deletePost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)\/delete$/);
  if (deletePost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(deletePost[1]!);
    const name = decodeURIComponent(deletePost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    // No typed confirmation (2026-09-08): the dialog asks the question
    // in a sentence, and the press is the answer.
    const result = deleteScheduleEntry(ctx.scheduleStore, project, name);
    if (!result.ok) return refusal({ error: result.error });
    return json({ ok: true });
  }
  return null;
}

async function scheduleRoute2(ctx: RoutesContext, req: Request, _url: URL, path: string): Promise<Response | null> {

  const editPost = path.match(/^\/api\/queue\/schedule\/([^/]+)\/([^/]+)$/);
  if (editPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(editPost[1]!);
    const name = decodeURIComponent(editPost[2]!);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    const current = ctx.scheduleStore.list(project).find((entry) => entry.name === name);
    const mismatch = pairRefusal(ctx, str(body.provider).trim() || current?.provider, str(body.model)) ??
      sandboxRefusal(ctx, body, current?.sandbox === false);
    if (mismatch) return mismatch;
    const result = updateScheduleEntry(ctx.scheduleStore, project, ctx.machineryProjectDir(project), name, {
      name: str(body.name), cron: str(body.cron), prompt: str(body.prompt), model: str(body.model), provider: str(body.provider), notify: str(body.notify), chrome: str(body.chrome), sandbox: str(body.sandbox),
    }, knownModels(ctx), knownProviders(ctx));
    if (!result.ok) return refusal({ error: result.error });
    const savedName = str(body.name).trim() || name;
    const postedEnabled = str(body.enabled);
    if (postedEnabled) {
      const enabled = setScheduleEnabled(ctx.scheduleStore, project, savedName, postedEnabled !== "no");
      if (!enabled.ok) return refusal({ error: enabled.error });
    }
    const back = scheduleBackPath(body.back, projectScheduleTab(project));
    return json({ ok: true, location: renamedBack(back, project, name, savedName) });
  }
  return null;
}

async function scheduleRoute3(ctx: RoutesContext, req: Request, _url: URL, path: string): Promise<Response | null> {

  // Project-agnostic, like `/api/queue/create`: no
  // per-resource segment left to key on, so the route validates the
  // body's own `project` claim against the allowlist instead of a URL
  // segment — same `ctx.allowed.has(project)` guard every other route
  // in this file already runs, checked before any read or write.
  if (path === "/api/queue/schedule") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
    const project = str(body.project);
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const mismatch = pairRefusal(ctx, str(body.provider).trim(), str(body.model)) ?? sandboxRefusal(ctx, body);
    if (mismatch) return mismatch;
    const result = createScheduleEntry(ctx.scheduleStore, project, ctx.machineryProjectDir(project), {
      name: str(body.name), cron: str(body.cron), prompt: str(body.prompt), model: str(body.model), provider: str(body.provider), notify: str(body.notify), chrome: str(body.chrome), sandbox: str(body.sandbox),
    }, knownModels(ctx), knownProviders(ctx));
    if (!result.ok) return refusal({ error: result.error });
    return json({ ok: true, location: scheduleBackPath(body.back, projectScheduleTab(project)) });
  }
  return null;
}

export async function handleScheduleAdminRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (
    (await scheduleRoute(ctx, req, url, path)) ??
    (await scheduleEnabledRoute(ctx, req, url, path)) ??
    (await scheduleRunRoute(ctx, req, url, path)) ??
    (await scheduleDeleteRoute(ctx, req, url, path)) ??
    (await scheduleRoute2(ctx, req, url, path)) ??
    (await scheduleRoute3(ctx, req, url, path)) ??
    null
  );
}
