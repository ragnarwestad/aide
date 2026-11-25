import { byTabPlace, jobRowKeys } from "../../../render/pages/jobs-page/rows.ts";
import { jobsEntries, activeExecutionGroups, type JobsView } from "../../../render/pages/jobs-page";
import { jobsViewRows } from "../../../render/pages/jobs-page/view.ts";
import { requestWindow, summaryJob, listSnapshot } from "../../list-window";
import { waitingGroups } from "../../../queue/waiting/jobs.ts";
// The Jobs tab at `/`: the board's first page. One of the route families
// `handlePageRoutes` asks in turn, and answers `null` for a path that is not
// its own.
import {
  ACTIVE_FILTER_KEY,
  APP_START_ROUTE,
  jobsShown,
  jobsTabHasRows,
  renderJobsPage,
  renderJobsRows,
  renderJobsSpecRows,
  rowInputs,
} from "../../../render";
import { jobsViewChoice, languageChoice, specsClientScript } from "../../serve-helpers";
import { listedSpecJobs, specRowOptions } from "./spec-row-options.ts";
import { projectChoices } from "./project-pin.ts";
import type { RoutesContext } from "..";

/** The rows the address opens, and the spec a Create just queued: `created`
 *  names its job, so the row is found by the job's key now, before the spec
 *  has its number and after it has one. */
export function openWithCreated(
  open: string | undefined,
  created: string | null,
  jobs: { id: string; project: string; specFolder: string }[],
): string | undefined {
  const job = created ? jobs.find((j) => j.id === created) : undefined;
  if (!job) return open;
  const key = `${job.project}/${job.specFolder}`;
  const keys = (open ?? "").split(",").filter(Boolean);
  return keys.includes(key) ? open : [...keys, key].join(",");
}

/** A project's specs, on disk and archived, each with its group's name: what
 *  `rowInputs` finds the other members of a spec's group by. */
function specsOf(ctx: RoutesContext, project: string): { specFolder: string; group?: string }[] {
  const live = ctx.targets().filter((t) => t.project === project).map((t) => ({ specFolder: t.specFolder, group: t.group?.name }));
  const archived = (ctx.readScan()?.archived ?? []).filter((key) => key.startsWith(`${project}/`)).map((key) => {
    const specFolder = key.slice(project.length + 1);
    return { specFolder, group: ctx.specRef(project, specFolder)?.group?.name };
  });
  return [...live, ...archived];
}

export async function jobsPage(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
  retry = true,
): Promise<Response | null> {
  if (path !== "/" && path !== APP_START_ROUTE) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

  const langResult = languageChoice(url, req);
  // The tab's own view, from the address or its own cookie.
  const choice = jobsViewChoice(url, req, ctx.serverPort());
  const jobs = ctx.queue.list();
  // The scheduled jobs and the Close, Reopen and deploy jobs, by the rules they follow.
  const shown = jobsShown(jobs, {
    scheduleEntryExists: (project, name) => ctx.scheduleStore.list(project).some((e) => e.name === name),
  });
  // The jobs a spec's row is drawn from, as the Specs list draws it.
  const specJobs = listedSpecJobs(ctx, jobs);
  const executionGroups = waitingGroups(ctx.queue);
  // `only` is the one row a fold opened or shut: the view is cut to what that
  // row is built from, so no other row is read. A key that is neither a job
  // row's nor a spec's cuts nothing.
  const only = path === "/" && url.searchParams.get("rows") ? url.searchParams.get("only") : null;
  const cut = only
    ? rowInputs(only, { shown, specJobs, groups: executionGroups, specsOf: (project) => specsOf(ctx, project) })
    : undefined;
  const rowOptions = specRowOptions(ctx, url, langResult.lang);
  const unchanged = listSnapshot(ctx, jobs);
  // The Project filter travels in the address alone, never in the view's cookie.
  const filter = { ...rowOptions.filter, ...choice.view, open: openWithCreated(rowOptions.filter?.open, url.searchParams.get("created"), jobs) };
  const summaryArchive = cut ? [] : ctx.archivedSpecSummaries?.() ?? [];
  const scheduleEntryExists = (project: string, name: string) => ctx.scheduleStore.list(project).some((entry) => entry.name === name);
  const waiting = ctx.queue.waiting.snapshot().entries;
  const summaryView: JobsView = {
    shown: shown.map(job => summaryJob(job, waiting)), specJobs: specJobs.map(job => summaryJob(job, waiting)), executionGroups,
    historySpecs: summaryArchive, scheduleEntryExists, specsScanned: ctx.specsScanned?.() ?? true,
    list: { ...rowOptions, summary: true, filter, archivedSpecs: summaryArchive },
  };
  const picked = pickRows(url, summaryView, filter, { shown, specJobs }, cut, only);
  const built = new Map(
    (await Promise.all([...new Set([...picked.kept.specJobs, ...picked.kept.shown])].map(ctx.jobRow))).map((r) => [r.id, r]),
  );
  if (!unchanged()) return retry ? jobsPage(ctx, req, url, path, false) : new Response("List changed; refresh the list.", { status: 409 });
  const view = await fullView(ctx, url, langResult.currentUrl, { rowOptions, filter, executionGroups, summaryView, cut, picked, built });
  return jobsResponse(ctx, url, path, view, only, [langResult.setCookie, choice.setCookie]);
}

type Job = ReturnType<RoutesContext["queue"]["list"]>[number];
type Filter = JobsView["list"]["filter"] & {};
type Cut = ReturnType<typeof rowInputs<Job>>;

/** The rows the request's window selects out of the tab's summaries, and the
 *  jobs and spec keys those rows are built from. A cut view has no summaries:
 *  its one row's inputs are what is kept. */
function pickRows(
  url: URL,
  summaryView: JobsView,
  filter: Filter,
  jobs: { shown: Job[]; specJobs: Job[] },
  cut: Cut,
  only: string | null,
) {
  const summaries = cut || only ? undefined : jobsEntries(summaryView, () => false).sort((a, b) => byTabPlace(a.place, b.place) || a.key.localeCompare(b.key));
  const matching = summaries ? jobsViewRows(summaries, filter) : [];
  const opened = new Set((filter.open ?? "").split(",").filter(Boolean));
  for (const row of summaries ?? []) if (row.facts.members?.some((member) => opened.has(`${member.project}/${member.specFolder}`))) opened.add(row.key);
  const selection = summaries ? requestWindow(matching, url, filter, opened) : undefined;
  const rowKeys = jobRowKeys(jobs.shown);
  const selectedKeys = new Set(selection?.rows.map((row) => row.key) ?? []);
  const keys = cut?.specs ?? new Set(selection?.rows.flatMap((row) => {
    const entry = summaries!.find((candidate) => candidate.key === row.key)!;
    if (entry.facts.ownJob) return [];
    return (entry.facts.members ?? [entry.facts]).map((member) => `${member.project}/${member.specFolder}`);
  }) ?? []);
  const kept = cut ?? {
    shown: jobs.shown.filter((job) => selectedKeys.has(rowKeys.get(job.id)!)),
    specJobs: jobs.specJobs.filter((job) => keys.has(`${job.project}/${job.specFolder}`)),
  };
  return { summaries, selection, rowKeys, keys, kept };
}

/** The tab's whole view: the picked rows built in full, and the list's options. */
async function fullView(
  ctx: RoutesContext,
  url: URL,
  currentUrl: string,
  parts: {
    rowOptions: ReturnType<typeof specRowOptions>;
    filter: Filter;
    executionGroups: JobsView["executionGroups"];
    summaryView: JobsView;
    cut: Cut;
    picked: ReturnType<typeof pickRows>;
    built: Map<string, Awaited<ReturnType<RoutesContext["jobRow"]>>>;
  },
): Promise<JobsView> {
  const { rowOptions, filter, executionGroups, summaryView, cut, picked, built } = parts;
  const { summaries, selection, rowKeys, keys, kept } = picked;
  return {
    selection, summaryEntries: summaries, summaryExecutionGroups: cut ? undefined : activeExecutionGroups(summaryView),
    limit: url.searchParams.get("limit") ?? undefined,
    shown: kept.shown.map((j) => built.get(j.id)!),
    specJobs: kept.specJobs.map((j) => built.get(j.id)!),
    specs: keys,
    rowKeys: cut?.rowKeys ?? rowKeys,
    specsScanned: ctx.specsScanned?.() ?? true,
    executionGroups,
    historySpecs: ctx.archivedSpecRows("all", keys),
    scheduleEntryExists: (project: string, name: string) =>
      ctx.scheduleStore.list(project).some((entry) => entry.name === name),
    list: {
      ...rowOptions,
      // The view travels in the rows' fold links, as the Specs list's filter does.
      filter,
      // The archived rows the list's Active entry shows: those whose branch has not merged.
      archivedSpecs: ctx.archivedSpecRows(ACTIVE_FILTER_KEY, keys),
      listPath: "/",
      // The Project filter's list: the projects a spec can be created in.
      createProjects: projectChoices(ctx),
      failedCreates: ctx.push.failedCreates.list(),
      currentUrl,
      script: await specsClientScript(),
    },
  };
}

/** The answer for the view: the app's start redirect, the rows alone, or the page. */
function jobsResponse(
  ctx: RoutesContext,
  url: URL,
  path: string,
  view: JobsView,
  only: string | null,
  setCookies: (string | undefined)[],
): Response {
  // The installed app's start: on to this tab when its saved view leaves a
  // row, and to the Specs list, bare, when it leaves none, so the list opens
  // with the state filter and sort its cookies keep.
  if (path === APP_START_ROUTE) {
    return new Response(null, { status: 302, headers: { location: jobsTabHasRows(view) ? "/" : "/specs" } });
  }

  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  for (const cookie of setCookies) if (cookie) headers.append("set-cookie", cookie);
  // The rows alone, as the Specs list answers its own redraw; `only` is the
  // one spec a fold opened or shut.
  if (url.searchParams.get("rows")) {
    return new Response(only ? renderJobsSpecRows(view, only) : renderJobsRows(view), { headers });
  }
  return new Response(renderJobsPage(view, new Date().toISOString(), ctx.nav()), { headers });
}
