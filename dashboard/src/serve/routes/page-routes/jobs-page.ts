// The Jobs tab at `/`: the board's first page. One of the route families
// `handlePageRoutes` asks in turn, and answers `null` for a path that is not
// its own.
import { jobsShown, renderJobsFollowParts, renderJobsPage } from "../../../render";
import { languageChoice, specsClientScript } from "../../serve-helpers";
import type { RoutesContext } from "..";

/** Whether the address carries one of the keys the Specs list reads: an old
 *  link to the list, from before it moved to `/specs`. The Jobs tab reads
 *  none of them. Each key is its own literal read, and `!== null` so that an
 *  empty value counts. */
function isOldListLink(url: URL): boolean {
  return (
    url.searchParams.get("rows") !== null ||
    url.searchParams.get("only") !== null ||
    url.searchParams.get("state") !== null ||
    url.searchParams.get("project") !== null ||
    url.searchParams.get("sort") !== null ||
    url.searchParams.get("dir") !== null ||
    url.searchParams.get("open") !== null ||
    url.searchParams.get("checks") !== null ||
    url.searchParams.get("phases") !== null ||
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
  // Decided on the raw jobs, so only the rows shown are built.
  const shown = jobsShown(ctx.queue.list(), {
    openFailedCreates: new Set(ctx.push.failedCreates.list().map((c) => c.id)),
    scheduleEntryExists: (project, name) => ctx.scheduleStore.list(project).some((e) => e.name === name),
  });
  const rows = await Promise.all(shown.map(ctx.jobRow));
  const titles = new Map(ctx.targets().map((t) => [`${t.project}/${t.specFolder}`, t.title]));
  const opts = {
    titleOf: (project: string, specFolder: string) => titles.get(`${project}/${specFolder}`),
    lang: langResult.lang,
  };

  if (url.searchParams.get("follow") === "1") {
    return new Response(renderJobsFollowParts(rows, opts), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const html = renderJobsPage(rows, new Date().toISOString(), ctx.nav(), {
    ...opts,
    currentUrl: langResult.currentUrl,
    script: await specsClientScript(),
  });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  return new Response(html, { headers });
}
