// the list itself, its redirect, and New spec. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { NEW_SPEC_ROUTE, renderNewSpecPage, renderSpecsPage, resolveBackHref, specPagePath } from "../../../render";
import { languageChoice, modelChoiceOptions, specsClientScript } from "../../serve-helpers";
import { listHeaders, specsListParts, specsRowsAnswer } from "./specs-list-view.ts";
import type { RoutesContext } from "..";

/** The typed text of a failed create, by its id; absent for an id that is not kept. */
function prefillFor(ctx: RoutesContext, id: string | null) {
  const r = id ? ctx.push.failedCreates.get(id) : undefined;
  return r ? { project: r.project, title: r.title, description: r.description } : undefined;
}

export async function specsPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path === "/queue") {
    return new Response(null, { status: 302, headers: { location: `/specs${url.search}` } });
  }

  if (path.startsWith("/queue/")) {
    // One segment is a job, which has its own address; more is a spec.
    const rest = path.slice("/queue".length);
    const base = /^\/[A-Za-z0-9-]+$/.test(rest) ? "/jobs" : "/specs";
    return new Response(null, { status: 302, headers: { location: `${base}${rest}${url.search}` } });
  }

  if (path === "/specs") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // A row is opened at the spec's own address, so a link that names one
    // here (a notification's, an older bookmark) is sent there, with the
    // rest of the query. With several keys it goes to the first.
    const first = (url.searchParams.get("open") ?? "").split(",").filter(Boolean)[0];
    const spec = first?.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
    // Only a spec there is a page for: a key nothing has yet (a create still
    // landing) leaves the list as it is.
    if (spec && ctx.specDir(spec[1]!, spec[2]!)) {
      const rest = url.search.slice(1).split("&").filter((pair) => pair && !pair.startsWith("open="));
      return new Response(null, {
        status: 302,
        headers: { location: `${specPagePath(spec[1]!, spec[2]!)}${rest.length ? `?${rest.join("&")}` : ""}` },
      });
    }
    const parts = await specsListParts(ctx, req, url);
    if (url.searchParams.get("rows")) return specsRowsAnswer(parts, url);
    return new Response(
      renderSpecsPage(await parts.rows(), new Date().toISOString(), ctx.nav(), parts.view),
      { headers: listHeaders(parts) },
    );
  }

  if (path === NEW_SPEC_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const langResult = languageChoice(url, req);
    const html = renderNewSpecPage(ctx.nav(), new Date().toISOString(), {
      createProjects: [...ctx.allowed].sort(),
      targets: ctx.withFreshness(ctx.targets()),
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/specs", url.pathname),
      script: await specsClientScript(),
      modelChoices: modelChoiceOptions(ctx.queue),
      defaultModels: ctx.queue.defaults.model,
      // "Try again" on a failed create's message (spec 506): what was typed.
      prefill: prefillFor(ctx, url.searchParams.get("retry")),
      tab: url.searchParams.get("tab") ?? undefined,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  return null;
}
