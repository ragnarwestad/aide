// the Schedule tab: its listing, one entry's own page, the page that makes an entry, and a run's recorded output. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import type { Language } from "../../../i18n";
import type { Job } from "../../../queue/types.ts";
import { providerPickerOptions } from "../../providers/options.ts";
import { scheduleTrackingKey } from "../../../project/spec-names.ts";
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, readScheduleRunReport } from "../../../queue/schedule.ts";
import { readProposalsRecord } from "../../../queue/spec-proposals.ts";
import { SCHEDULE_OUTPUT_ROUTE_PREFIX, scheduleOutputRelativePath, scheduleRunOutputPath } from "../../../schedule-output-route.ts";
import {
  NEW_SCHEDULE_DEFAULTS, SCHEDULE_ROUTE, buildReportDocument, projectPagePath, renderProposalsPanel, renderReportPanel,
  renderScheduleDetailPage, renderSchedulePage, renderSchedulePromptPage, resolveBackHref,
} from "../../../render";
import { SPEC_VIEWER_ASSET_PATH, languageChoice, modelChoiceOptions, modelsInUse, specsClientScript } from "../../serve-helpers";
import { serveStatic } from "../../serve-helpers";
import type { RoutesContext } from "..";
import { scheduleLastRun } from "./schedule-last-run.ts";
import { projectScheduleTab, scheduleNewPageResponse } from "./schedule-edit-page.ts";
import { forProject } from "../../../queue/providers/project-defaults.ts";

async function schedulePageRoute(ctx: RoutesContext, req: Request, _url: URL, path: string): Promise<Response | null> {
  if (path.startsWith(SCHEDULE_OUTPUT_ROUTE_PREFIX)) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return serveStatic(
      ctx.opts.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT,
      scheduleOutputRelativePath(path),
    );
  }
  return null;
}

async function schedulePageRoute2(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  if (path === SCHEDULE_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // Every allowed project's entries, flattened together —
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
      modelNames: Object.keys(ctx.queue.defaults.modelChoices ?? {}),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }
  return null;
}

async function scheduleNewRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  // New: the project rides as a query, since a second path segment would
  // read as an entry's name. An entry is changed on its Settings tab.
  if (path === "/schedule/new") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // A project off the allowlist still gets the page, as its Schedule
    // tab still gets New: the create route refuses it, with the reason.
    const project = url.searchParams.get("project") ?? "";
    if (!project) return new Response("not found", { status: 404 });
    return scheduleNewPageResponse(ctx, req, url, {
      project,
      values: NEW_SCHEDULE_DEFAULTS,
      back: resolveBackHref(req.headers.get("referer"), url.origin, projectScheduleTab(project), url.pathname),
    });
  }
  return null;
}

async function schedulePromptRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  // A job's prompt file. The address names a job, never a file: what is read
  // is always the entry's own `prompt`, which the store keeps inside the
  // project, and any other address matches nothing.
  const promptPage = path.match(/^\/schedule\/([^/]+)\/([^/]+)\/prompt$/);
  if (promptPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(promptPage[1]!);
    const name = decodeURIComponent(promptPage[2]!);
    if (!ctx.allowed.has(project)) return new Response("not found", { status: 404 });
    const entry = ctx.scheduleStore.list(project).find((e) => e.name === name);
    if (!entry) return new Response("not found", { status: 404 });
    // The directory a run of this entry is handed, at its default branch as the
    // last pull left it. Never fetched here: the default branch of a shared
    // checkout moves only under the per-root lock a run's pull holds.
    const dir = ctx.machineryProjectDir(project);
    const base = await ctx.branchStatus.defaultBranch(dir);
    // `cat-file blob` answers only for a file: a directory, which `git show`
    // prints as a listing, reads as not there.
    const shown = base
      ? await ctx.gitRun(dir, ["cat-file", "blob", `refs/remotes/origin/${base}:${entry.prompt}`])
      : null;
    const langResult = languageChoice(url, req);
    const html = renderSchedulePromptPage(ctx.nav(), new Date().toISOString(), {
      project,
      entry,
      text: shown?.code === 0 ? shown.stdout : null,
      viewerSrc: SPEC_VIEWER_ASSET_PATH,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }
  return null;
}

/** The Report tab: the picked run's report and the specs it proposed, or
 *  the empty list's sentence for an entry that has never run. */
async function reportPanelFor(
  ctx: RoutesContext, lang: Language,
  o: { outputRoot: string; project: string; key: string; shown: Job | undefined; jobs: Job[] },
): Promise<string> {
  const { outputRoot, project, key, shown, jobs } = o;
  if (!shown) return jobs.length === 0 ? renderReportPanel({ lang }) : "";
  const report = readScheduleRunReport(outputRoot, project, key, shown.id);
  const runDir = scheduleRunOutputPath(project, key, shown.id);
  const run: Parameters<typeof renderReportPanel>[0]["run"] = {
    view: await ctx.jobRow(shown),
    startedAt: shown.startedAt ?? shown.createdAt,
    ...(report !== null
      ? { document: await buildReportDocument(report, runDir) }
      : {}),
  };
  return renderReportPanel({ lang, run }) +
    renderProposalsPanel({
      lang, project, record: readProposalsRecord(outputRoot, project, key, shown.id),
      specOf: (jobId) => {
        const made = ctx.queue.get(jobId);
        return made?.state === "done" ? made.specFolder : undefined;
      },
    });
}

async function scheduleDetailRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

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
    const langResult = languageChoice(url, req);
    // `?run=` is only ever compared with this entry's own job ids, never
    // joined into a path. A report shows only for a run picked from the
    // list; without one, the Report tab is the list alone.
    const runParam = url.searchParams.get("run");
    const shown = jobs.find((j) => j.id === runParam);
    const tab = url.searchParams.get("tab") ?? undefined;
    const html = renderScheduleDetailPage(ctx.nav(), new Date().toISOString(), {
      project,
      entry,
      tab,
      // Settings' edit state, from the address alone: a reload without it
      // lands back on what is saved.
      editing: tab === "settings" && url.searchParams.get("edit") === "1",
      modelChoices: modelChoiceOptions(ctx.queue, modelsInUse(ctx)),
      // What a scheduled job of this project runs on, the project's own choice included.
      defaultModels: forProject(ctx.queue.defaults, project).model,
      ...providerPickerOptions(ctx.queue),
      defaultProviders: forProject(ctx.queue.defaults, project).provider,
      deleteDone: projectScheduleTab(project),
      runs: jobs,
      shownRun: shown?.id,
      // Only ever compared with the list's column names.
      runSort: { sort: url.searchParams.get("sort") ?? undefined, dir: url.searchParams.get("dir") ?? undefined },
      // An entry that has never run says so here, where the list would be.
      reportPanel: await reportPanelFor(ctx, langResult.lang, { outputRoot, project, key, shown, jobs }),
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

export async function schedulePages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (
    (await schedulePageRoute(ctx, req, url, path)) ??
    (await schedulePageRoute2(ctx, req, url, path)) ??
    (await scheduleNewRoute(ctx, req, url, path)) ??
    (await schedulePromptRoute(ctx, req, url, path)) ??
    (await scheduleDetailRoute(ctx, req, url, path)) ??
    null
  );
}
