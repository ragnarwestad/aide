// The Jobs tab at `/`: the board's first page. One of the route families
// `handlePageRoutes` asks in turn, and answers `null` for a path that is not
// its own.
import { ACTIVE_FILTER_KEY, jobsShown, renderJobsPage, renderJobsRows, renderJobsSpecRows } from "../../../render";
import { languageChoice, specsClientScript } from "../../serve-helpers";
import { listedSpecJobs, specRowOptions } from "./spec-row-options.ts";
import type { RoutesContext } from "..";

/** Whether the address carries one of the keys that cut or order the Specs
 *  list: an old link to the list, from before it moved to `/specs`. The Jobs
 *  tab reads none of them. Each key is its own literal read, and `!== null`
 *  so that an empty value counts. `rows`, `only`, `open`, `checks` and
 *  `phases` are the Jobs tab's own. */
function isOldListLink(url: URL): boolean {
  return (
    url.searchParams.get("state") !== null ||
    url.searchParams.get("project") !== null ||
    url.searchParams.get("sort") !== null ||
    url.searchParams.get("dir") !== null ||
    url.searchParams.get("q") !== null
  );
}

export async function jobsPage(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path !== "/") return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (isOldListLink(url)) return new Response(null, { status: 302, headers: { location: `/specs${url.search}` } });

  const langResult = languageChoice(url, req);
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
  const view = {
    shown: shown.map((j) => built.get(j.id)!),
    specJobs: specJobs.map((j) => built.get(j.id)!),
    list: {
      ...specRowOptions(ctx, url, langResult.lang),
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
  // The rows alone, as the Specs list answers its own redraw; `only` is the
  // one spec a fold opened or shut.
  if (url.searchParams.get("rows")) {
    const only = url.searchParams.get("only");
    return new Response(only ? renderJobsSpecRows(view, only) : renderJobsRows(view), { headers });
  }
  return new Response(renderJobsPage(view, new Date().toISOString(), ctx.nav()), { headers });
}
