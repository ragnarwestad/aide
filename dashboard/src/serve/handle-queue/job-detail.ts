// The job detail route: /api/queue/:id and /specs/:id. Extracted
// from handle-queue.ts (split of split serve.ts step 2). Its regex
// matches a single-segment id under /api/queue/ or /specs/, which
// overlaps with the exact-string routes handled elsewhere (e.g.
// /api/queue/create) — it MUST be tried last, after every other
// theme, exactly as it sat last in the original dispatcher.
import { json } from "../serve-helpers.ts";
import { renderJobDetailPage, resolveBackHref } from "../../render.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

export async function handleJobDetailRoute(
  ctx: HandleQueueContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  const detail = path.match(/^\/(api\/queue|specs)\/([A-Za-z0-9-]+)$/);
  if (detail) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, surface, id] = detail;
    const api = surface !== "specs";
    const job = ctx.queue.get(id!);
    if (!job) {
      return api ? json({ error: "no such job" }, 404) : new Response("not found", { status: 404 });
    }
    if (api) return json({ generatedAt: new Date().toISOString(), job });
    const html = renderJobDetailPage(
      { ...(await ctx.jobDetailView(job)), backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/") },
      new Date().toISOString(),
      ctx.nav(),
      {
        tab: url.searchParams.get("tab") ?? undefined,
        step: url.searchParams.get("step") ?? undefined,
      },
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return null;
}
