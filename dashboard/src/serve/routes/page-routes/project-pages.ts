// Settings, Add and Remove project, a project's own page and the Projects listing. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { pendingCommits } from "../../deploy-job/commits.ts";
import { providerPickerOptions } from "../../providers/options.ts";
import { readProviderStatus } from "../../providers/status.ts";
import { providerDetailFor } from "../providers/page.ts";
import { selectedProviderKey } from "../../../render/pages/settings-page/providers.ts";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildProjectViews, manifestInside, gitignoreCandidates, resolveCodeLanding, resolveInstallCmd, resolvePreviewFrom } from "../../../project/discover";
import { projectSettings } from "../../../project/project-settings.ts";
import { projectIconSource, projectIconSrc } from "./project-icon.ts";
import { pinnedProjects, projectPinned } from "./project-pin.ts";
import { hiddenProjects } from "./project-hide.ts";
import { deployUnderWay } from "../../../queue/queue.ts";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT, dashboardSettingsFile } from "../../../git/dashboard-checkout/index.ts";
import { assessProjectReadiness, manifestTracked, settingsHome } from "../../../project/project-admin";
import { ADD_PROJECT_ROUTE, PROJECTS_ROUTE, PROVIDERS_ROUTE, SETTINGS_ROUTE, TEST_SERVERS_ROUTE, providersAddressFor, renderAddProjectPage, renderProjectPage, renderProjectsPage, renderProvidersPage, renderSettingsPage, renderTestServersPage, resolveBackHref, specPagePath, type ProviderStatus, type TestServerRow } from "../../../render";
import { MAIN_TEST_SERVER_KEY, refreshTestServerStatus } from "../../test-servers/lifecycle.ts";
import { testServerFailedPage, testServerUrlFor, waitingForTestServerPage } from "../spec-edit/test-server-waiting.ts";
import { isSpecFolder } from "../../../project/spec-names.ts";
import { languageChoice, modelChoiceOptions, modelsInUse, processSettings, specsClientScript } from "../../serve-helpers";
import type { RoutesContext } from "..";

/** Every provider's status, read side by side. */
async function readProviderStatuses(ctx: RoutesContext): Promise<Record<string, ProviderStatus>> {
  const read = ctx.opts.providerProbe ?? readProviderStatus;
  const providers = Object.entries(ctx.queue.defaults.providers ?? {});
  return Object.fromEntries(await Promise.all(providers.map(async ([key, provider]) => [key, await read(key, provider)] as const)));
}

/** The page, as HTML, with the language cookie the request asked for. */
function htmlResponse(html: string, setCookie: string | undefined): Response {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(html, { headers });
}

/** The Providers page. It reads every provider's status as it opens, and the
 *  chosen provider's tab: a read can hold the page for as long as its timeout. */
async function providersPageResponse(ctx: RoutesContext, req: Request, url: URL): Promise<Response> {
  const langResult = languageChoice(url, req);
  const providerStatuses = await readProviderStatuses(ctx);
  const providers = ctx.queue.defaults.providers;
  const chosen = selectedProviderKey(providers, url.searchParams.get("provider"));
  const detail = chosen
    ? await providerDetailFor(ctx, chosen, providers![chosen]!, providerStatuses[chosen], url.searchParams.get("aitab") ?? undefined, langResult.lang)
    : undefined;
  const html = renderProvidersPage(ctx.nav(), new Date().toISOString(), {
    providers, statuses: providerStatuses, detail,
    backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/", url.pathname),
    script: await specsClientScript(),
    lang: langResult.lang,
    currentUrl: langResult.currentUrl,
  });
  return htmlResponse(html, langResult.setCookie);
}

async function projectPageRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {
  if (path === PROVIDERS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return providersPageResponse(ctx, req, url);
  }
  if (path === SETTINGS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // A bookmark or link to a tab that moved to the Providers page opens it there.
    const moved = providersAddressFor({
      tab: url.searchParams.get("tab"), provider: url.searchParams.get("provider"), aitab: url.searchParams.get("aitab"),
    });
    if (moved) return new Response(null, { status: 302, headers: { location: moved } });
    const langResult = languageChoice(url, req);
    const html = renderSettingsPage(ctx.nav(), new Date().toISOString(), {
      modelChoices: modelChoiceOptions(ctx.queue, modelsInUse(ctx)),
      defaultModels: ctx.queue.defaults.model,
      ...providerPickerOptions(ctx.queue),
      timeoutSec: ctx.queue.defaults.timeoutSec,
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/", url.pathname),
      script: await specsClientScript(),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
      tab: url.searchParams.get("tab") ?? undefined,
      pushPublicKey: await ctx.push.publicKey(),
      process: processSettings(ctx.runner, ctx.opts.queueConcurrency),
    });
    return htmlResponse(html, langResult.setCookie);
  }
  return null;
}

async function projectPageRoute2(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  if (path === TEST_SERVERS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // Refresh and filter in one pass: the dead-board check may
    // remove an entry right here (a "running" board whose process has
    // since died) — dropped from this page the same read that found it
    // gone, rather than drawn once more before the next visit clears it.
    const rows: TestServerRow[] = ctx.testServers.store
      .listAll()
      .map(({ project, specFolder }) => ({
        project,
        specFolder,
        entry: refreshTestServerStatus(ctx.testServers, project, specFolder),
      }))
      .filter((r) => r.entry !== undefined)
      .map(({ project, specFolder, entry }) => ({
        project,
        specFolder,
        specHref: specPagePath(project, specFolder),
        branch: entry!.branch,
        status: entry!.status,
        // The address the READER can reach: the round prints a loopback one.
        url: entry!.url ? testServerUrlFor(req, entry!.url) : undefined,
        // `MAIN_TEST_SERVER_KEY` has no real spec to be scoped to — the
        // spec-scoped route would 404 on it.
        stopAction: isSpecFolder(specFolder)
          ? `/api/queue${specPagePath(project, specFolder)}/test-server/stop`
          : `/api/queue/projects/${encodeURIComponent(project)}/test-server/stop`,
      }));
    const langResult = languageChoice(url, req);
    const html = renderTestServersPage(ctx.nav(), new Date().toISOString(), rows, {
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/", url.pathname),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
      script: await specsClientScript(),
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }
  return null;
}

async function projectPageRoute3(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  if (path === ADD_PROJECT_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // Send the reader to the page that now explains it, instead of the
    // file that no longer exists.
    if (!ctx.opts.projectRoot) {
      return new Response(null, { status: 302, headers: { location: PROJECTS_ROUTE } });
    }
    const langResult = languageChoice(url, req);
    const html = renderAddProjectPage(ctx.nav(), new Date().toISOString(), {
      script: await specsClientScript(),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }
  return null;
}

function mainTestServerWait(ctx: RoutesContext, req: Request, name: string): Response {
  const already = refreshTestServerStatus(ctx.testServers, name, MAIN_TEST_SERVER_KEY);
  if (already?.status === "running" && already.url) {
    return Response.redirect(testServerUrlFor(req, already.url), 303);
  }
  if (already?.status === "failed") {
    return testServerFailedPage(name, MAIN_TEST_SERVER_KEY, already.error, undefined, already.detail);
  }
  if (!already) {
    // A bookmarked or shared URL, with nobody's POST behind it —
    // nothing to wait for.
    return new Response(null, {
      status: 303,
      headers: { location: `/projects/${encodeURIComponent(name)}?tab=deploy` },
    });
  }
  return waitingForTestServerPage(name, MAIN_TEST_SERVER_KEY);
}

/** Which commit this process serves, beside the checkout's own; only for
 *  the one project the server runs from. */
async function servingState(ctx: RoutesContext, driftRoot: string, drift: { checkedAt: number | null } | undefined) {
  const { sha: servingSha, repoRoot: servingRepoRoot } = ctx.readServing();
  if (!(servingSha && servingRepoRoot && resolve(driftRoot) === resolve(servingRepoRoot))) return undefined;
  return (async () => {
    const head = await ctx.gitRun(driftRoot, ["rev-parse", "HEAD"]);
    if (head.code !== 0) return undefined;
    const checkoutHead = head.stdout.trim();
    const current = servingSha === checkoutHead;
    // Only fetched while origin itself has not
    // been checked yet — the one sentence that needs to say what
    // the served commit actually is, never a bare hash.
    if (drift?.checkedAt !== null) return { sha: servingSha, checkoutHead, current };
    const subj = await ctx.gitRun(driftRoot, ["log", "-1", "--format=%s", checkoutHead]);
    const newestSubject = subj.code === 0 ? subj.stdout.trim() : undefined;
    if (current) return { sha: servingSha, checkoutHead, current, newestSubject };
    const count = await ctx.gitRun(driftRoot, ["rev-list", "--count", `${servingSha}..${checkoutHead}`]);
    // Same guard `branch-status.ts`'s own `commitsBehindOrigin`
    // uses for the identical command: a zero exit with
    // non-numeric stdout must not render as "NaN commits behind".
    const parsed = count.code === 0 ? Number.parseInt(count.stdout.trim(), 10) : NaN;
    const behindCount = Number.isFinite(parsed) ? parsed : undefined;
    return { sha: servingSha, checkoutHead, current, newestSubject, behindCount };
  })().catch(() => undefined);
}

/** The project page's icon and Deploy tab. */
async function projectDeployOptions(
  ctx: RoutesContext, name: string,
  o: { drift: ReturnType<RoutesContext["branchStatus"]["peekDrift"]> | undefined; serving: Awaited<ReturnType<typeof servingState>>; boardItself: boolean },
) {
  const { drift, serving, boardItself } = o;
  return {
    icon: await projectIconSrc(ctx, name),
    iconSource: projectIconSource(ctx, name),
    drift,
    deployFailure: ctx.readDeployFailure(name),
    serving,
    restartWaiting: ctx.readPendingRestart()?.jobs,
    boardItself,
    deployUnderWay: deployUnderWay(ctx.queue.list(), name),
    // The same capability check the spec-page's own
    // test-server link already gates on.
    testServerAvailable: ctx.testServers.previewAvailable(name),
  };
}

/** The project page's picker, settings, schedule and models. */
async function projectSettingsOptions(
  ctx: RoutesContext, url: URL, name: string,
  o: { dir: string; manifestDir: string; views: ReturnType<typeof buildProjectViews>; hidden: Set<string>; pending: unknown },
) {
  const { dir, manifestDir, views, hidden } = o;
  const pending = o.pending as Awaited<ReturnType<typeof pendingCommits>> | undefined;
  return {
    // The picker's list: the projects the Projects list shows, the
    // hidden ones left out.
    projects: await Promise.all(
      views.filter((p) => ctx.allowed.has(p.name) && !hidden.has(p.name))
        .map(async (p) => ({ name: p.name, icon: await projectIconSrc(ctx, p.name) })),
    ),
    script: await specsClientScript(),
    // Specs root and Worktree links are no longer read a second
    // time here: `projectSettings(dir, readiness)`
    // above already resolved both, and the table draws its Value
    // cells straight off those same rows — one read per row's
    // data, not two that could drift.
    codeLanding: resolveCodeLanding(manifestDir),
    previewFrom: resolvePreviewFrom(manifestDir) ?? "none",
    settingsHome: settingsHome(
      // Fail open like the readiness above: a git that is not there
      // leaves the page standing, and counts as "cannot say".
      (await manifestTracked(ctx.gitRun, ctx.machineryProjectDir(name)).catch(() => ({ tracked: null }))).tracked,
      existsSync(dashboardSettingsFile(ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT, name)),
    ),
    // The one resolver, never a second copy of the question: two
    // would eventually disagree, and the one that decides where a
    // merge lands is not the one to get it wrong
    // (`git/branch-status.ts`).
    // `.catch`, like `readiness` above: a git that throws must leave
    // the page standing. A name nobody could fetch is no name, and
    // the choice falls back to the general word.
    defaultBranch: (await ctx.branchStatus.defaultBranch(dir).catch(() => null)) ?? undefined,
    pending,
    schedule: ctx.scheduleStore.list(name),
    scheduleSort: {
      sort: url.searchParams.get("sort") ?? undefined,
      dir: (url.searchParams.get("dir") as "asc" | "desc" | null) ?? undefined,
    },
    scheduleModelNames: Object.keys(ctx.queue.defaults.modelChoices ?? {}),
    worktreeLinkCandidates: gitignoreCandidates(dir),
    pinnedProjects: pinnedProjects(ctx),
    pinned: projectPinned(ctx, name),
    hidden: hidden.has(name),
    models: {
      defaults: ctx.queue.defaults,
      modelChoices: modelChoiceOptions(ctx.queue, modelsInUse(ctx)),
      providerChoices: providerPickerOptions(ctx.queue).providerChoices,
    },
  };
}

// The tab the Deploy button's POST opened WAITS here, the same
// way `spec-page.ts`'s own `?startTestServer=1` does — but this GET never
// starts or restarts a board itself (the POST route already did, or
// nobody ever pressed the button at all).
// Read fresh, uncached, exactly as `/projects` does: nothing polls
// this page, so a scan per request is cheap enough to redo every
// time — and no invalidation to get wrong.
// Fail open, the way the drift check on `/projects` does. Every
// check inside `assessProjectReadiness` already treats a git that
// answers nothing as its own kind of failure rather than throwing,
// so this catches the case where git is not there to be run at
// all: the reader came for the project's page, and the half of it
// that needs no git is still worth serving.
// Read-only, like `/projects`' own drift map: `peekDrift` is a
// cache lookup, never a git call — the page's own "never merges,
// pulls, fetches or checks anything out" contract
// (project-detail-readiness-and-deploy.test.ts) must hold here too.
// The board's own Deploy needs an install command; every other project
// is only counted against origin, whatever it has configured.
// Only meaningful for the one project this very process runs from —
// every other project's checkout HEAD has nothing to do with this
// server's own boot-time SHA, so the comparison stays undefined there.
// What a Deploy pressed now would take in: from what this process
// serves to origin as the drift check last fetched it. Read only.
// The manifest a run reads is the dashboard's own checkout's.
// A clone that is still being made, or has none yet, answers
// with the project's own directory, as everything did before.
async function projectPageGetRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  const projectPage = path.match(/^\/projects\/([^/]+)$/);
  if (projectPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(projectPage[1]!);
    if (!ctx.opts.projectRoot) return new Response("no such project\n", { status: 404 });
    if (url.searchParams.get("startTestServer") === "1") return mainTestServerWait(ctx, req, name);
    const views = buildProjectViews(ctx.opts.projectRoot, ctx.ownedSpecsRoot, manifestInside(ctx.machineryProjectDir));
    const view = views.find((p) => p.name === name);
    if (!view) return new Response("no such project\n", { status: 404 });
    const dir = ctx.displayProjectDir(name);
    const readiness = await assessProjectReadiness(ctx.gitRun, dir, ctx.machineryProjectDir(name)).catch(() => null);
    const driftRoot = ctx.machineryProjectDir(name);
    const boardItself = ctx.deploy.isBoard(driftRoot);
    const drift = !boardItself || resolveInstallCmd(driftRoot).value
      ? ctx.branchStatus.peekDrift(driftRoot)
      : undefined;
    const serving = await servingState(ctx, driftRoot, drift);
    const base = serving ? await ctx.branchStatus.defaultBranch(driftRoot).catch(() => null) : null;
    const pending = serving && base ? await pendingCommits(driftRoot, serving.sha, base, ctx.gitRun).catch(() => undefined) : undefined;
    const machinery = ctx.machineryProjectDir(name);
    const manifestDir = existsSync(join(machinery, ".aide", "project.yaml")) ? machinery : dir;
    const langResult = languageChoice(url, req);
    const hidden = hiddenProjects(ctx);
    const html = renderProjectPage(
      view,
      projectSettings(dir, readiness, manifestDir),
      readiness,
      new Date().toISOString(),
      ctx.nav(),
      {
        ...(await projectSettingsOptions(ctx, url, name, { dir, manifestDir, views, hidden, pending })),
        ...(await projectDeployOptions(ctx, name, { drift, serving, boardItself })),
        tab: url.searchParams.get("tab") ?? undefined,
        lang: langResult.lang,
        currentUrl: langResult.currentUrl,
      },
    );
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }
  return null;
}

/** Whether a run could start in each project; a host that cannot answer
 *  leaves the row as the generated page has always drawn it. */
async function readinessOf(ctx: RoutesContext, names: string[]): Promise<Record<string, boolean>> {
  const readinessByProject: Record<string, boolean> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        const { canRun } = await assessProjectReadiness(
          ctx.gitRun,
          ctx.displayProjectDir(name),
          ctx.machineryProjectDir(name),
        );
        readinessByProject[name] = canRun;
      } catch {
        // The listing is what the reader came for: a host with no
        // `git` on PATH must still get the page, and a row with
        // nothing to say about readiness is exactly the row the
        // generated page has always drawn.
        readinessByProject[name] = true;
      }
    }),
  );
  return readinessByProject;
}

// No `--root`, no project set: an empty listing would read as "no
// projects on this machine" rather than "this server was never told
// where they are" — so render the ordinary (empty) listing with a
// notice explaining why, instead of bouncing to a page that would
// just redirect back here.
// Read fresh, uncached: unlike `/` nothing polls this page, so a
// scan per request is cheap enough to redo every time — and no
// invalidation to get wrong. Only the projects on the allowlist, as
// on the specs list: a directory under the projects root that is not
// on it is not one of the board's projects.
// Whether a run could start in each project, asked on
// every visit. The Add flow answered this exactly once, in the
// query string of the redirect it landed on — so an operator who
// did not act on it there had no way to rediscover what was
// missing except by starting a run and having it refused. Now the
// row says it, and carries the Settings link that acts on it.
// Concurrent, like the drift check above, and read-only.
// Only a project the allowlist knows has anything to be removed from.
async function projectsListRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {

  if (path === PROJECTS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    if (!ctx.opts.projectRoot) {
      const langResult = languageChoice(url, req);
      const html = renderProjectsPage([], new Date().toISOString(), ctx.nav(), {
        error: "this board was started with no project root, so it has no projects to list",
        backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/", url.pathname),
        lang: langResult.lang,
        currentUrl: langResult.currentUrl,
      });
      const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
      if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
      return new Response(html, { headers });
    }
    const projects = buildProjectViews(ctx.opts.projectRoot, ctx.ownedSpecsRoot, manifestInside(ctx.machineryProjectDir))
      .filter((p) => ctx.allowed.has(p.name));
    const readinessByProject = await readinessOf(ctx, projects.map((p) => p.name));
    const iconByProject = Object.fromEntries(
      await Promise.all(projects.map(async (p) => [p.name, await projectIconSrc(ctx, p.name)] as const)),
    );
    const langResult = languageChoice(url, req);
    const html = renderProjectsPage(
      projects,
      new Date().toISOString(),
      ctx.nav(),
      {
        readinessByProject,
        iconByProject,
        pinnedProjects: pinnedProjects(ctx),
        hiddenProjects: hiddenProjects(ctx),
        removable: (name) => ctx.allowed.has(name),
        backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/", url.pathname),
        script: await specsClientScript(),
        lang: langResult.lang,
        currentUrl: langResult.currentUrl,
      },
    );
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }
  return null;
}

export async function projectPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (
    (await projectPageRoute(ctx, req, url, path)) ??
    (await projectPageRoute2(ctx, req, url, path)) ??
    (await projectPageRoute3(ctx, req, url, path)) ??
    (await projectPageGetRoute(ctx, req, url, path)) ??
    (await projectsListRoute(ctx, req, url, path)) ??
    null
  );
}
