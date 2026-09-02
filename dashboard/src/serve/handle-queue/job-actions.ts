// The job-level API routes: listing/creating a job at /api/queue,
// cancel, and the two tail-edit routes (steps, model). Extracted
// from handle-queue.ts (split of split serve.ts step 2).
import { FROM_LIST_FIELD, specPagePath } from "../../render.ts";
import { bodyToObject, json, logRefusal, readBounded, specsRedirect } from "../serve-helpers.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

export async function handleJobActionRoutes(
  ctx: HandleQueueContext,
  req: Request,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  if (path === "/api/queue") {
    if (req.method === "GET") {
      return json({ generatedAt: new Date().toISOString(), jobs: ctx.queue.list() });
    }
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // Where a no-script form POST comes back to: the page the press
    // came FROM, because a redirect is the only answer such a form
    // gets and a reader dropped somewhere else cannot tell whether the
    // button did anything (spec 157).
    //
    // Reopen is the one control offered in two places (spec 198, and
    // spec 221 for the row). An archived spec's own page still gets
    // its answer there; a press on the list's own reader row says so
    // with `FROM_LIST_FIELD` and is answered on the list, filter and
    // all — `specsRedirect` rebuilds the view from the `view.*` fields
    // the same form carries. The marker is what decides it, never a
    // destination taken from the browser.
    const askedFor = raw as Record<string, unknown> | null;
    const backTo =
      askedFor?.[FROM_LIST_FIELD] !== "1" &&
      typeof askedFor?.project === "string" &&
      typeof askedFor?.specFolder === "string" &&
      ctx.specRef(askedFor.project, askedFor.specFolder)?.archived
        ? specPagePath(askedFor.project, askedFor.specFolder)
        : "/";
    const result = ctx.queue.enqueue(raw);
    if (!result.ok) {
      // Which spec was asked for, off the SUBMITTED fields — the two
      // `parseJobRequest` already requires, so this adds no trust
      // surface. It is never rendered as text either: the page only
      // compares it against a row's own key.
      const asked = raw as Record<string, unknown> | null;
      const spec =
        typeof asked?.project === "string" && typeof asked?.specFolder === "string"
          ? `${asked.project}/${asked.specFolder}`
          : undefined;
      logRefusal("run", spec, result.error);
      // A person who pressed a button gets the reason on the page
      // they pressed it from; an API caller gets a status code.
      // `spec` for the same reason merge's answer carries it: the page
      // shows a refusal on the row it belongs to and no longer
      // navigates to find out which, so the answer has to say.
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(raw, { error: result.error, spec }, backTo);
    }
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw, undefined, backTo);
  }

  const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/cancel$/);
  if (action) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = action;
    const job = ctx.queue.get(id);
    if (!job) return json({ error: "no such job" }, 404);
    // The body is read for ONE thing: the view the press came from,
    // so the redirect can put the reader back on it. A JSON caller
    // sends no body at all, and an unparseable one is not a reason to
    // refuse an action that needs nothing from it.
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let view: unknown = {};
    try {
      if (sent.text) view = bodyToObject(sent.text, req.headers.get("content-type"));
    } catch {
      view = {};
    }
    // Only a job that still owns its work can be cancelled. A finished
    // job's state is history — done, failed, stopped — and writing
    // "cancelled" over it would say someone ended a run that had
    // already ended on its own. The table's own `queued`/`running`
    // entries for `cancel` are what draws that line now.
    const result = ctx.queue.transition(id, "cancel", { finishedAt: new Date().toISOString() });
    if (!result.ok) {
      const spec = `${job.project}/${job.specFolder}`;
      const reason = `the job is already ${result.state}; only a queued or running job can be cancelled`;
      logRefusal("cancel", spec, reason);
      return wantsJson ? json({ error: reason, spec }, 409) : specsRedirect(view, { error: reason, spec });
    }
    // SIGTERM to the GROUP, never a bare pid: claude spawns
    // children, and a kill that only reaches the parent is not a
    // bound.
    if (job.pgid !== undefined) {
      try {
        process.kill(-job.pgid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(view);
  }

  const tailEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/steps$/);
  if (tailEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    // A form sends the tick as text, an API caller as a boolean. Both
    // say the same thing, and the box's own state is what they say:
    // ticked adds the step, unticked removes it.
    const checked = body.checked;
    const add =
      checked === true ||
      (typeof checked === "string" && ["1", "true", "on", "yes"].includes(checked.toLowerCase()));
    const spec = `${job.project}/${job.specFolder}`;
    const result = ctx.queue.editTailStep(id!, step, add);
    if (!result.ok) {
      logRefusal("steps", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(body, { error: result.error, spec });
    }
    // Now, not on the next two-second timer: a step added in the
    // instant the running one finishes would otherwise wait for it.
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
  }

  const tailModelEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/model$/);
  if (tailModelEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailModelEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    const model = typeof body.model === "string" ? body.model : "";
    const spec = `${job.project}/${job.specFolder}`;
    const result = ctx.queue.editTailModel(id!, step, model);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(body, { error: result.error, spec });
    }
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
  }

  return null;
}
