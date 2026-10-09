// The Jobs tab at `/`: the board's first page. One of the route families
// `handlePageRoutes` asks in turn, and answers `null` for a path that is not
// its own.
import { ACTIVE_FILTER_KEY, jobsShown, renderJobsPage, renderJobsRows, renderJobsSpecRows } from "../../../render";
import { jobsViewChoice, languageChoice, specsClientScript } from "../../serve-helpers";
import { listedSpecJobs, specRowOptions } from "./spec-row-options.ts";
import type { RoutesContext } from "..";

export async function jobsPage(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path !== "/") return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

  const langResult = languageChoice(url, req);
  // The tab's own view, from the address or its own cookie.
  const choice = jobsViewChoice(url, req, ctx.serverPort());
  const jobs = ctx.queue.list();
  // The jobs a spec's row is drawn from, as the Specs list draws it.
  const specJobs = listedSpecJobs(ctx, jobs);
  // The wiki builds and scheduled jobs, by the rules they follow.
  const shown = jobsShown(jobs, {
    scheduleEntryExists: (project, name) => ctx.scheduleStore.list(project).some((e) => e.name === name),
  });
  const built = new Map(
    (await Promise.all([...new Set([...specJobs, ...shown])].map(ctx.jobRow))).map((r) => [r.id, r]),
  );
  const rowOptions = specRowOptions(ctx, url, langResult.lang);
  const view = {
    shown: shown.map((j) => built.get(j.id)!),
    specJobs: specJobs.map((j) => built.get(j.id)!),
    list: {
      ...rowOptions,
      // The view travels in the rows' fold links, as the Specs list's filter does.
      filter: { ...rowOptions.filter, ...choice.view },
      // The archived rows the list's Active entry shows: those whose branch has not merged.
      archivedSpecs: ctx.archivedSpecRows(ACTIVE_FILTER_KEY),
      listPath: "/",
      failedCreates: ctx.push.failedCreates.list(),
      currentUrl: langResult.currentUrl,
      script: await specsClientScript(),
    },
  };

  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  if (choice.setCookie) headers.append("set-cookie", choice.setCookie);
  // The rows alone, as the Specs list answers its own redraw; `only` is the
  // one spec a fold opened or shut.
  if (url.searchParams.get("rows")) {
    const only = url.searchParams.get("only");
    return new Response(only ? renderJobsSpecRows(view, only) : renderJobsRows(view), { headers });
  }
  return new Response(renderJobsPage(view, new Date().toISOString(), ctx.nav()), { headers });
}
