// the Schedule tab: its listing, a new entry, one entry's own page and its delete confirmation, and a run's recorded output. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveSchedule } from "../../../project/discover.ts";
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, scheduleOutputDir, scheduleTrackingKey } from "../../../queue/schedule.ts";
import { SCHEDULE_ROUTE, renderDeleteSchedulePage, renderNewSchedulePage, renderScheduleDetailPage, renderSchedulePage, resolveBackHref } from "../../../render.ts";
import { queueClientScript } from "../../serve-helpers.ts";
import { serveStatic } from "../../serve-helpers/static.ts";
import type { HandleQueueContext } from "../../handle-queue.ts";

export async function schedulePages(
  ctx: HandleQueueContext,
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
        const outputExists = existsSync(join(scheduleOutputDir(outputRoot, project, key), "index.html"));
        return {
          project,
          entry,
          lastState: last?.state,
          lastRunAt: last?.startedAt ?? last?.createdAt,
          outputHref: outputExists ? `/schedule-output/${project}/${key}/index.html` : undefined,
        };
      }),
    );
    const html = renderSchedulePage(ctx.nav(), new Date().toISOString(), {
      projects,
      rows,
      token: ctx.queueToken,
      script: await queueClientScript(),
      filter: {
        q: url.searchParams.get("q") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
        dir: (url.searchParams.get("dir") as "asc" | "desc" | null) ?? undefined,
      },
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  if (path === "/schedule/new") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const html = renderNewSchedulePage(ctx.nav(), new Date().toISOString(), {
      projects: [...ctx.allowed].sort(),
      token: ctx.queueToken,
      script: await queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name, budgetUsd: choice.budgetUsd, ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const scheduleDeletePage = path.match(/^\/schedule\/([^/]+)\/([^/]+)\/delete$/);
  if (scheduleDeletePage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const project = decodeURIComponent(scheduleDeletePage[1]!);
    const name = decodeURIComponent(scheduleDeletePage[2]!);
    if (!ctx.allowed.has(project)) return new Response("not found", { status: 404 });
    const entry = resolveSchedule(ctx.machineryProjectDir(project)).find((e) => e.name === name);
    if (!entry) return new Response("not found", { status: 404 });
    const html = renderDeleteSchedulePage(ctx.nav(), new Date().toISOString(), {
      project,
      entryName: name,
      token: ctx.queueToken,
      script: await queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
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
    const outputExists = existsSync(join(scheduleOutputDir(outputRoot, project, key), "index.html"));
    const history = jobs.map((job, i) => ({
      job,
      outputHref: i === 0 && outputExists ? `/schedule-output/${project}/${key}/index.html` : undefined,
    }));
    const html = renderScheduleDetailPage(ctx.nav(), new Date().toISOString(), {
      project,
      entry,
      tab: url.searchParams.get("tab") ?? undefined,
      history,
      token: ctx.queueToken,
      script: await queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, SCHEDULE_ROUTE),
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name, budgetUsd: choice.budgetUsd, ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return null;
}
