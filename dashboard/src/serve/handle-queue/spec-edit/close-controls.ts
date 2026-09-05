// The Close control and its confirmation page (spec 406): the other
// operation that ends a work round, beside Reset — one of the three
// families `handleSpecEditRoutes` asks in turn. Split out on its own
// rather than folded into run-controls.ts, so that file stays the size
// its own header comment already notes a 2026-09-04 split at.
import { renderCloseSpecPage, specPagePath } from "../../../render.ts";
import { bodyToObject, json, logRefusal, queueClientScript, readBounded, specsRedirect } from "../../serve-helpers.ts";

import type { HandleQueueContext } from "../../handle-queue.ts";

export async function closeControlRoutes(
  ctx: HandleQueueContext,
  req: Request,
  url: URL,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  const closePage = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/close$/);
  if (closePage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = closePage;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref || ref.archived) return new Response("not found", { status: 404 });
    return new Response(
      renderCloseSpecPage(project!, specFolder!, ctx.nav(), new Date().toISOString(), {
        token: ctx.queueToken,
        error: url.searchParams.get("error") ?? undefined,
        script: await queueClientScript(),
      }),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const closePost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/close$/);
  if (closePost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = closePost;
    const back = `${specPagePath(project!, specFolder!)}/close`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const refuseClose = (error: string): Response =>
      wantsJson ? json({ error }, 400) : specsRedirect({}, { error }, back);
    // REQ-3: a reason is the one thing this form requires — trimmed, so
    // whitespace alone reads exactly as empty does.
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return refuseClose("type a reason to close this spec");
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    if (ref.archived) return refuseClose(`${specFolder} is archived — Close is only for active specs`);
    // REQ-11: the same job-in-flight check Reset's own POST makes.
    if (ctx.queue.list().some((job) => job.landing)) return refuseClose("a landing is in progress");
    if (ctx.queue.list().some((job) =>
      job.project === project && job.specFolder === specFolder &&
      (job.state === "queued" || job.state === "running")
    )) return refuseClose("another job for this spec is still running");
    const result = ctx.queue.enqueue({ project, specFolder, steps: ["close"], closeReason: reason });
    if (!result.ok) {
      logRefusal("close", `${project}/${specFolder}`, result.error);
      return refuseClose(result.error);
    }
    await ctx.tickRunner();
    return wantsJson
      ? json({ ok: true, job: result.job })
      : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
  }

  return null;
}
