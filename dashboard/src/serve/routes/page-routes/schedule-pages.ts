// the Schedule tab: its listing, one entry's own page, the page that makes or changes an entry, and a run's recorded output. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, readScheduleRunReport, scheduleTrackingKey } from "../../../queue/schedule.ts";
import { readProposalsRecord } from "../../../queue/spec-proposals.ts";
import {
  NEW_SCHEDULE_DEFAULTS, SCHEDULE_ROUTE, buildReportDocument, projectPagePath, renderProposalsPanel, renderReportPanel,
  renderScheduleDetailPage, renderSchedulePage, resolveBackHref, schedulePagePath,
} from "../../../render";
import { languageChoice, specsClientScript } from "../../serve-helpers";
import { serveStatic } from "../../serve-helpers";
import type { RoutesContext } from "..";
import { scheduleLastRun } from "./schedule-last-run.ts";
import { projectScheduleTab, scheduleEditPageResponse } from "./schedule-edit-page.ts";

export async function schedulePages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path.startsWith("/schedule-output/")) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return serveStatic(
      ctx.opts.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT,
      path.slice("/schedule-output".length),
    );
  }

  if (path === SCHEDULE_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // Every allowed project's entries, flattened together (spec 278) —
    // no per-project filter, mirroring how the Specs list's own
    // `listed` array is every allowed project's jobs at once.
    const projects = [...ctx.allowed].sort();
    const rows = projects.flatMap((project) =>
      ctx.scheduleStore.list(project).map((entry) => ({
        project,
        entry,
        ...scheduleLastRun(ctx, project, entry.name),
        // The project's own Schedule tab — where New and this entry's
        // own controls live.
        projectScheduleHref: `${projectPagePath(project)}?tab=schedule`,
      })),
    );
    const langResult = languageChoice(url, req);
    const html = renderSchedulePage(ctx.nav(), new Date().toISOString(), {
      rows,
      script: await specsClientScript(),
      filter: {
        q: url.searchParams.get("q") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
        dir: (url.searchParams.get("dir") as "asc" | "desc" | null) ?? undefined,
      },
      error: url.searchParams.get("error") ?? undefined,
      modelNames: Object.keys(ctx.queue.defaults.modelChoices ?? {}),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  // New and Edit: one page. The project rides as a query on New, since
  // a second path segment would read as an entry's name.
  if (path === "/schedule/new") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // A project off the allowlist still gets the page, as its Schedule
    // tab still gets New: the create route refuses it, with the reason.
    const project = url.searchParams.get("project") ?? "";
    if (!project) return new Response("not found", { status: 404 });
    return scheduleEditPageResponse(ctx, req, url, {
      project,
      values: NEW_SCHEDULE_DEFAULTS,
      back: resolveBackHref(req.headers.get("referer"), url.origin, projectScheduleTab(project), url.pathname),
    });
  }
  const scheduleEditPage = path.match(/^\/schedule\/([^/]+)\/([^/]+)\/edit$/);
  if (scheduleEditPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(scheduleEditPage[1]!);
    const name = decodeURIComponent(scheduleEditPage[2]!);
    if (!ctx.allowed.has(project)) return new Response("not found", { status: 404 });
    const entry = ctx.scheduleStore.list(project).find((e) => e.name === name);
    if (!entry) return new Response("not found", { status: 404 });
    return scheduleEditPageResponse(ctx, req, url, {
      project,
      editing: name,
      values: entry,
      back: resolveBackHref(req.headers.get("referer"), url.origin, projectScheduleTab(project), url.pathname),
    });
  }

  const scheduleDetailPage = path.match(/^\/schedule\/([^/]+)\/([^/]+)$/);
  if (scheduleDetailPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(scheduleDetailPage[1]!);
    const name = decodeURIComponent(scheduleDetailPage[2]!);
    if (!ctx.allowed.has(project)) return new Response("not found", { status: 404 });
    const entry = ctx.scheduleStore.list(project).find((e) => e.name === name);
    if (!entry) return new Response("not found", { status: 404 });
    const key = scheduleTrackingKey(name);
    const jobs = ctx.queue
      .list()
      .filter((j) => j.project === project && j.specFolder === key)
      .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt));
    const outputRoot = ctx.opts.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT;
    const page = schedulePagePath(project, name);
    const history = jobs.map((job) => ({
      job,
      outputHref: `${page}?run=${encodeURIComponent(job.id)}#report`,
    }));
    const langResult = languageChoice(url, req);
    // `?run=` is only ever compared with this entry's own job ids, never
    // joined into a path; anything else shows the newest run.
    const runParam = url.searchParams.get("run");
    // With no run asked for, the newest FINISHED run: a run that is queued
    // or still going has no report yet, and would hide last week's.
    const unfinished = (j: (typeof jobs)[number]) => j.state === "queued" || j.state === "running";
    const pendingJob = runParam ? undefined : jobs.find(unfinished);
    const shown = jobs.find((j) => j.id === runParam) ?? jobs.find((j) => !unfinished(j));
    let run: Parameters<typeof renderReportPanel>[0]["run"];
    if (shown) {
      const report = readScheduleRunReport(outputRoot, project, key, shown.id);
      const runDir = `/schedule-output/${project}/${key}/runs/${shown.id}/`;
      run = {
        view: await ctx.jobRow(shown),
        startedAt: shown.startedAt ?? shown.createdAt,
        ...(report !== null
          ? { document: await buildReportDocument(report, runDir), bareHref: `${runDir}index.html` }
          : {}),
      };
    }
    const html = renderScheduleDetailPage(ctx.nav(), new Date().toISOString(), {
      project,
      entry,
      tab: url.searchParams.get("tab") ?? undefined,
      history,
      reportPanel:
        renderReportPanel({
          lang: langResult.lang, run,
          ...(pendingJob ? { pending: pendingJob.state as "queued" | "running" } : {}),
        }) +
        renderProposalsPanel({
          lang: langResult.lang,
          project,
          record: shown ? readProposalsRecord(outputRoot, project, key, shown.id) : null,
        }),
      script: await specsClientScript(),
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, projectScheduleTab(project), url.pathname),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  return null;
}
