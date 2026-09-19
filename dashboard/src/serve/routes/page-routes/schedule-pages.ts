// the Schedule tab: its listing, a new entry, one entry's own page and its delete confirmation, and a run's recorded output. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { resolveSchedule } from "../../../project/discover";
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, readScheduleRunReport, scheduleTrackingKey } from "../../../queue/schedule.ts";
import {
  SCHEDULE_ROUTE, buildReportDocument, projectPagePath, renderDeleteSchedulePage, renderReportPanel,
  renderScheduleDetailPage, renderSchedulePage, resolveBackHref, schedulePagePath,
} from "../../../render";
import { languageChoice, specsClientScript } from "../../serve-helpers";
import { serveStatic } from "../../serve-helpers";
import type { RoutesContext } from "..";

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
    const outputRoot = ctx.opts.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT;
    // Every allowed project's entries, flattened together (spec 278) —
    // no per-project filter, mirroring how the Specs list's own
    // `listed` array is every allowed project's jobs at once.
    const projects = [...ctx.allowed].sort();
    const rows = projects.flatMap((project) =>
      resolveSchedule(ctx.machineryProjectDir(project)).map((entry) => {
        const key = scheduleTrackingKey(entry.name);
        const jobs = ctx.queue.list().filter((j) => j.project === project && j.specFolder === key);
        const last = jobs.sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))[0];
        const wroteReport = last ? readScheduleRunReport(outputRoot, project, key, last.id) !== null : false;
        return {
          project,
          entry,
          lastState: last?.state,
          lastRunAt: last?.startedAt ?? last?.createdAt,
          // The report is shown on the entry's own page, not linked bare.
          outputHref: wroteReport ? `${schedulePagePath(project, entry.name)}#report` : undefined,
          // AC-5: the project's own Schedule tab — where the New-job
          // form and this entry's own row both now live (spec 468).
          projectScheduleHref: `${projectPagePath(project)}?tab=schedule`,
        };
      }),
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

  const scheduleDeletePage = path.match(/^\/schedule\/([^/]+)\/([^/]+)\/delete$/);
  if (scheduleDeletePage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(scheduleDeletePage[1]!);
    const name = decodeURIComponent(scheduleDeletePage[2]!);
    if (!ctx.allowed.has(project)) return new Response("not found", { status: 404 });
    const entry = resolveSchedule(ctx.machineryProjectDir(project)).find((e) => e.name === name);
    if (!entry) return new Response("not found", { status: 404 });
    const langResult = languageChoice(url, req);
    const html = renderDeleteSchedulePage(ctx.nav(), new Date().toISOString(), {
      project,
      entryName: name,
      script: await specsClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  const scheduleDetailPage = path.match(/^\/schedule\/([^/]+)\/([^/]+)$/);
  if (scheduleDetailPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(scheduleDetailPage[1]!);
    const name = decodeURIComponent(scheduleDetailPage[2]!);
    if (!ctx.allowed.has(project)) return new Response("not found", { status: 404 });
    const entry = resolveSchedule(ctx.machineryProjectDir(project)).find((e) => e.name === name);
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
    const shown = jobs.find((j) => j.id === runParam) ?? jobs[0];
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
      reportPanel: renderReportPanel({ lang: langResult.lang, run }),
      script: await specsClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, SCHEDULE_ROUTE),
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name, ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  return null;
}
