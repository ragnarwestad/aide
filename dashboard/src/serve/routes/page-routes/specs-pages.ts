// the list itself, its two redirects, and New spec. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { NEW_SPEC_ROUTE, renderNewSpecPage, renderSpecsPage, renderSpecsRows, resolveBackHref } from "../../../render";
import { languageChoice, specsClientScript, sortChoice, stateChoice } from "../../serve-helpers";
import { phaseMessagesFor } from "../../spec-views/phase-messages.ts";
import { isWikiBuild } from "../../../queue/steps.ts";
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
  if (path === "/queue" || path === "/specs") {
    return new Response(null, { status: 302, headers: { location: `/${url.search}` } });
  }

  if (path.startsWith("/queue/")) {
    return new Response(null, {
      status: 302,
      headers: { location: `/specs${path.slice("/queue".length)}${url.search}` },
    });
  }

  if (path === "/") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const liveTargets = ctx.withFreshness(ctx.targets());
    const archivedKeys = ctx.readScan()?.archived ?? [];
    // spec 406, REQ-7: the closed subset of the same cheap key list, off
    // `ctx.specRef` — the same per-key lookup job-actions.ts already
    // uses, never a second walk.
    const closedKeys = archivedKeys.filter((k) => {
      const cut = k.indexOf("/");
      return ctx.specRef(k.slice(0, cut), k.slice(cut + 1))?.closed;
    });
    // Off the same lookup: the archived specs with a Not verified row,
    // what the Not verified entry's count adds where no row is built.
    const notVerifiedKeys = archivedKeys.filter((k) => {
      const cut = k.indexOf("/");
      const ref = ctx.specRef(k.slice(0, cut), k.slice(cut + 1));
      return (ref?.notVerified ?? 0) + (ref?.failed ?? 0) > 0;
    });
    // The reader's own choice of state, from the address or from the
    // cookie it was last written into (spec 338, mirroring the sort
    // column's own `chosenSort` below).
    const stateResult = stateChoice(url, req, ctx.serverPort());
    const chosenState = stateResult.state;
    // The reader's own choice of language (spec 350), from the address
    // or from the cookie it was last written into — the same shape as
    // the sort/state pair above, with one difference: this always
    // resolves to a concrete language, never `{}`.
    const langResult = languageChoice(url, req);
    // Every archived spec is a row on this list since spec 221 — but
    // only for a reader whose chip asks for one. The builder decides
    // that itself, off the same `filterShowsArchived` the filter's entries are
    // defined by, and the scale question is why: aide alone archives
    // about 150 specs, this page rebuilds itself on every change
    // event on every open tab, and the default view must not pay for
    // a set it does not show.
    const archivedSpecs = ctx.archivedSpecRows(chosenState);
    // The reader's own choice of column, from the address or from the
    // cookie it was last written into.
    const chosenSort = sortChoice(url, req, ctx.serverPort());
    const view = {
      runnerAvailable: ctx.opts.runnerAvailable ?? ctx.runner !== null,
      targets: liveTargets,
      archived: archivedKeys,
      closed: closedKeys,
      notVerified: notVerifiedKeys,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
      // Spec 506: the creates that ended without a spec and were not
      // dismissed — a message each, above the filter bar.
      failedCreates: ctx.push.failedCreates.list(),
      archivedSpecs,
      script: await specsClientScript(),
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, c]) => ({
        name,
        // Carried so the option can SAY which CLI it starts: two
        // entries that differ only in that would otherwise be two
        // identical-looking names in the same dropdown.
        ...(c.tool ? { tool: c.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      // A model picked for a phase before any job exists (spec 308).
      // Only this view — the `/` page and its `?rows=1` poll — draws a
      // phase's own picker; the other four views built in this file
      // (New spec, Settings, new-schedule, schedule-detail) render no
      // phase picker and need nothing here.
      pendingModels: ctx.queue.pendingModels,
      // The sibling of pendingModels, for an effort level (spec 364).
      // Which phases a reader chose — at create time, or at a later Run
      // — recorded so a fresh render shows that choice instead of
      // re-deriving one from history alone (spec 439).
      pendingSteps: ctx.queue.pendingSteps,
      error: url.searchParams.get("error") ?? undefined,
      // Which row the refusal belongs to. It rides in the query
      // string with the reason itself, so it survives the
      // five-second row swap the same way the filter does.
      errorSpec: url.searchParams.get("errorSpec") ?? undefined,
      // The raw allowlist, not the discovered set: a project whose
      // FIRST spec this form exists to make has nothing on disk to be
      // discovered from, so deriving these from `targets()` would
      // leave it out of the one dropdown it needs to be in. Every
      // other list on this page stays derived, because every other
      // control is about a spec that already exists.
      createProjects: [...ctx.allowed].sort(),
      // Spec 466, AC-3: the bare function reference, the same one
      // `spec-page.ts:198` and `project-pages.ts:280` already call —
      // never a wrapper or a re-derived copy.
      testServerAvailable: ctx.testServers.previewAvailable,
      // Spec 500: the messages of a phase the address unfolded. Called
      // only for those, so a redraw reads no transcript for a phase nobody
      // opened.
      phaseMessages: (attemptIds: string[], step: string) => phaseMessagesFor(ctx.queue, attemptIds, step),
      // Straight from the query string: how the list is cut and
      // ordered lives in the URL, so it survives a reload and can be
      // sent to someone else. Nothing here is trusted — the renderer
      // falls back to its defaults for anything it does not know.
      //
      // The SORT alone falls back to what the reader last chose
      // (`sortChoice`) rather than to the renderer's default: every
      // other part of the filter is set from a control on this page
      // and read back off the same address, but the sort is thrown
      // away by every plain link to `/` there is.
      filter: {
        state: chosenState,
        project: url.searchParams.get("project") ?? undefined,
        sort: chosenSort.sort,
        dir: chosenSort.dir,
        open: url.searchParams.get("open") ?? undefined,
        checks: url.searchParams.get("checks") ?? undefined,
        phases: url.searchParams.get("phases") ?? undefined,
        // The search term (spec 221), a query-string citizen like the
        // rest of the view — so it survives a reload, can be pasted to
        // someone else, and rides along on the SSE-driven row swap,
        // which sends `location.search` back verbatim.
        q: url.searchParams.get("q") ?? undefined,
      },
    };
    // The rows alone: the page swaps them from script every few
    // seconds, so a half-filled form is never wiped by a refresh.
    // Only the projects the queue may run. A project taken out of the
    // allowlist keeps its jobs in the history (and in /api/queue), but
    // a row for it could only offer a Run that would be refused.
    // A schedule job is not a spec (spec 259's own tracking key never
    // resolves under the specs root — `parseJobRequest`'s exemption for
    // it) and has no spec folder for a row's name link to point at:
    // left in here it drew a row whose name linked to
    // `/specs/<project>/schedule-<name>`, a 404, and an action button
    // that got refused with "unknown specFolder" on every press. Its
    // own history lives on `/schedule`'s detail page instead.
    // A wiki build is no spec either: its state is on the project's Wiki tab.
    const listed = ctx.queue.list().filter(
      (j) => ctx.allowed.has(j.project) && !j.specFolder.startsWith("schedule-") && !isWikiBuild(j),
    );
    if (url.searchParams.get("rows")) {
      // The sort cookie is written HERE as well as on the whole page,
      // and this is the one that matters: pressing a column heading
      // never reloads the page. The script rewrites the address and
      // fetches these rows alone, so a cookie set only on the full
      // page would never be written by the very act of choosing.
      const rowHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
      if (chosenSort.setCookie) rowHeaders.append("set-cookie", chosenSort.setCookie);
      if (stateResult.setCookie) rowHeaders.append("set-cookie", stateResult.setCookie);
      if (langResult.setCookie) rowHeaders.append("set-cookie", langResult.setCookie);
      return new Response(renderSpecsRows(await Promise.all(listed.map(ctx.jobRow)), view), {
        headers: rowHeaders,
      });
    }
    const html = renderSpecsPage(
      await Promise.all(listed.map(ctx.jobRow)),
      new Date().toISOString(),
      ctx.nav(),
      view,
    );
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    // A `Headers` rather than the record it was built from: several
    // cookies can be handed over on one response — the sort, the state
    // and the language a shared link carried — and a record has room
    // for one `set-cookie`.
    const pageHeaders = new Headers(headers);
    if (chosenSort.setCookie) pageHeaders.append("set-cookie", chosenSort.setCookie);
    if (stateResult.setCookie) pageHeaders.append("set-cookie", stateResult.setCookie);
    if (langResult.setCookie) pageHeaders.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers: pageHeaders });
  }

  if (path === NEW_SPEC_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const langResult = languageChoice(url, req);
    const html = renderNewSpecPage(ctx.nav(), new Date().toISOString(), {
      createProjects: [...ctx.allowed].sort(),
      targets: ctx.withFreshness(ctx.targets()),
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      script: await specsClientScript(),
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name,
        ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      // "Try again" on a failed create's message (spec 506): what was typed.
      prefill: prefillFor(ctx, url.searchParams.get("retry")),
      // Why the last submission was refused, carried back here by the
      // create route's own redirect.
      error: url.searchParams.get("error") ?? undefined,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  return null;
}
