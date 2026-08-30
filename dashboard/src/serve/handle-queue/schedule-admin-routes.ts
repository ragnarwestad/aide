// The schedule entry API routes (spec 276): create, edit, the Enabled
// toggle, Run-now, and the live cron-next preview. Modeled on
// `spec-edit.ts`'s reset route and `queue-admin.ts`'s settings route —
// refuse before any write, then either a JSON answer (script) or a
// no-JS redirect back to the list.
import { createScheduleEntry, deleteScheduleEntry, setScheduleEnabled, updateScheduleEntry } from "../../project/project-admin.ts";
import { nextFireTime, scheduleTrackingKey } from "../../queue/schedule.ts";
import { deleteSchedulePath, SCHEDULE_ROUTE } from "../../render.ts";
import { bodyToObject, json, readBounded, specsRedirect } from "../serve-helpers.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

const CRON_NEXT_ROUTE = "/api/queue/schedule/cron-next";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

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
  ctx: HandleQueueContext,
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
    const result = setScheduleEnabled(ctx.machineryProjectDir(project), name, enabled);
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
    // itself calls (acceptance criterion 9) — no new mechanism.
    const result = ctx.queue.enqueue({ project, specFolder: scheduleTrackingKey(name), steps: ["schedule"] });
    const back = SCHEDULE_ROUTE;
    if (!result.ok) return wantsJson ? json({ error: result.error }, 400) : specsRedirect({}, { error: result.error }, back);
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
    if (body.confirm !== name) {
      const error = `type ${name} exactly to confirm Delete`;
      return wantsJson ? json({ error }, 400) : specsRedirect(body, { error }, back);
    }
    const result = deleteScheduleEntry(ctx.machineryProjectDir(project), name);
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
    const result = updateScheduleEntry(ctx.machineryProjectDir(project), name, {
      name: str(body.name), cron: str(body.cron), prompt: str(body.prompt),
    });
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
    if (!ctx.allowed.has(project)) return json({ error: `"${project}" is not a project this dashboard knows` }, 400);
    const result = createScheduleEntry(ctx.machineryProjectDir(project), {
      name: str(body.name), cron: str(body.cron), prompt: str(body.prompt),
    });
    if (!result.ok) return wantsJson ? json({ error: result.error }, 400) : specsRedirect(body, { error: result.error }, SCHEDULE_ROUTE);
    return wantsJson ? json({ ok: true }) : specsRedirect(body, undefined, SCHEDULE_ROUTE);
  }

  return null;
}
