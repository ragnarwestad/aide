// The job detail route: /api/queue/:id and /jobs/:id. Extracted
// from routes.ts (split of split serve.ts step 2). Its regex
// matches a single-segment id under /api/queue/ or /jobs/, which
// overlaps with the exact-string routes handled elsewhere (e.g.
// /api/queue/create) — it MUST be tried last, after every other
// theme, exactly as it sat last in the original dispatcher.
import { json, languageChoice, specsClientScript } from "../serve-helpers";
import { renderJobDetailPage, resolveBackHref } from "../../render";
import { jobMarks } from "../spec-views/job-marks.ts";
import type { RoutesContext } from "./";

export async function handleJobDetailRoute(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  // A job's page was /specs/<id> before it had an address of its own; a
  // link saved from then goes on to the same page and tab.
  const old = path.match(/^\/specs\/([A-Za-z0-9-]+)$/);
  if (old && req.method === "GET") {
    return new Response(null, { status: 301, headers: { location: `/jobs/${old[1]}${url.search}` } });
  }
  const detail = path.match(/^\/(api\/queue|jobs)\/([A-Za-z0-9-]+)$/);
  if (detail) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, surface, id] = detail;
    const api = surface !== "jobs";
    const job = ctx.queue.get(id!);
    if (!job) {
      return api ? json({ error: "no such job" }, 404) : new Response("not found", { status: 404 });
    }
    // `?marks=1` adds the steps the job's log has marked, for the dialog a
    // Close or Reopen stands in while it runs; without it, no file is read.
    if (api && url.searchParams.get("marks") === "1") {
      return json({ generatedAt: new Date().toISOString(), job, ...jobMarks(job, languageChoice(url, req).lang) });
    }
    if (api) return json({ generatedAt: new Date().toISOString(), job });
    const langResult = languageChoice(url, req);
    const html = renderJobDetailPage(
      { ...(await ctx.jobDetailView(job)), backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/", url.pathname) },
      new Date().toISOString(),
      ctx.nav(),
      {
        tab: url.searchParams.get("tab") ?? undefined,
        step: url.searchParams.get("step") ?? undefined,
        steptab: url.searchParams.get("steptab") ?? undefined,
        lang: langResult.lang,
        currentUrl: langResult.currentUrl,
        // The page script: it reloads the page every ten seconds.
        script: await specsClientScript(),
      },
    );
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  return null;
}
