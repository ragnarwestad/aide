// Settings, Add and Remove project, a project's own page and the Projects listing. One of the three route families `handlePageRoutes`
// asks in turn (split 2026-09-04: the file had reached 594 lines,
// a single function with a chain of route checks in it).
//
// Every check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own — which is what lets the
// three be asked one after another exactly as the chain read before.
import { join, resolve } from "node:path";
import { buildProjectViews, configValue, discoverUnclaimedDirectories, gitignoreCandidates, resolveCodeLanding, resolveInstallCmd, resolveSchedule } from "../../../project/discover";
import { projectSettings } from "../../../project/project-settings.ts";
import { assessProjectReadiness, suggestSpecsPath, suggestWorktreeLinksFromLockfile } from "../../../project/project-admin";
import { ADD_PROJECT_ROUTE, OVERVIEW_PAGE, PROJECTS_ROUTE, SETTINGS_ROUTE, TEST_SERVERS_ROUTE, renderAddProjectPage, renderProjectPage, renderProjectsPage, renderRemoveProjectPage, renderSettingsPage, renderTestServersPage, resolveBackHref, specPagePath, type TestServerRow } from "../../../render";
import { MAIN_TEST_SERVER_KEY, refreshTestServerStatus } from "../../test-servers/lifecycle.ts";
import { testServerFailedPage, testServerUrlFor, waitingForTestServerPage } from "../spec-edit/test-server-waiting.ts";
import { isSpecFolder } from "../../../render/ui/shell.ts";
import { languageChoice, specsClientScript } from "../../serve-helpers";
import type { RoutesContext } from "..";

export async function projectPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path === SETTINGS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const langResult = languageChoice(url, req);
    const html = renderSettingsPage(ctx.nav(), new Date().toISOString(), {
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name, budgetUsd: choice.budgetUsd, ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      budgetUsd: ctx.queue.defaults.budgetUsd,
      jobCapUsd: ctx.queue.defaults.jobCapUsd,
      timeoutSec: ctx.queue.defaults.timeoutSec,
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      script: await specsClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      notice: url.searchParams.get("notice") ?? undefined,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  if (path === TEST_SERVERS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // Refresh and filter in one pass: REQ-2's own dead-board check may
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
        url: entry!.url,
        // AC-7: `MAIN_TEST_SERVER_KEY` has no real spec to be scoped to — the
        // spec-scoped route would 404 on it.
        stopAction: isSpecFolder(specFolder)
          ? `/api/queue${specPagePath(project, specFolder)}/test-server/stop`
          : `/api/queue/projects/${encodeURIComponent(project)}/test-server/stop`,
      }));
    const langResult = languageChoice(url, req);
    const html = renderTestServersPage(ctx.nav(), new Date().toISOString(), rows, {
      token: ctx.queueToken,
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  if (path === ADD_PROJECT_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    if (!ctx.opts.projectRoot) {
      return new Response(null, { status: 302, headers: { location: `/${OVERVIEW_PAGE}` } });
    }
    // Read fresh per request, the way /projects reads its own scan:
    // a checkout that appeared on the host a minute ago is offered.
    const unclaimed = discoverUnclaimedDirectories(ctx.opts.projectRoot);
    const langResult = languageChoice(url, req);
    const html = renderAddProjectPage(ctx.nav(), new Date().toISOString(), {
      token: ctx.queueToken,
      script: await specsClientScript(),
      existingCheckouts: unclaimed,
      // And what each of them ignores, which is where the worktree
      // links a run needs are named (spec 140). The union, deduped
      // and sorted: nothing has been picked yet at the moment this
      // page is drawn.
      worktreeLinkCandidates: [
        ...new Set(unclaimed.flatMap((d) => gitignoreCandidates(join(ctx.opts.projectRoot!, d)))),
      ].sort(),
      // Spec 184: what each of them would be configured with, worked
      // out rather than asked for — the checkout's own lockfile for
      // the links, and how the projects already added lay their specs
      // out for the specs root. Anything that cannot be worked out
      // comes back empty and is rendered as a blank field.
      proposalsByCheckout: Object.fromEntries(
        unclaimed.map((d) => [
          d,
          {
            specsPath: suggestSpecsPath(
              d,
              [...ctx.allowed].map((name) => ({
                name,
                specsPath: configValue(ctx.displayProjectDir(name), "AIDE_SPECS_PATH"),
              })),
            ),
            worktreeLinks: suggestWorktreeLinksFromLockfile(join(ctx.opts.projectRoot!, d)),
          },
        ]),
      ),
      error: url.searchParams.get("error") ?? undefined,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  const removePage = path.match(/^\/projects\/([^/]+)\/remove$/);
  if (removePage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(removePage[1]!);
    // Only a project the allowlist knows has anything to be removed
    // from — everything else is a mistyped address.
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return new Response("no such project\n", { status: 404 });
    }
    const langResult = languageChoice(url, req);
    const html = renderRemoveProjectPage(name, ctx.nav(), new Date().toISOString(), {
      token: ctx.queueToken,
      script: await specsClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  const settingsPage = path.match(/^\/projects\/([^/]+)\/settings$/);
  if (settingsPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(settingsPage[1]!);
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return new Response("no such project\n", { status: 404 });
    }
    return new Response(null, {
      status: 302,
      headers: { location: `/projects/${encodeURIComponent(name)}` },
    });
  }

  const projectPage = path.match(/^\/projects\/([^/]+)$/);
  if (projectPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(projectPage[1]!);
    if (!ctx.opts.projectRoot) return new Response("no such project\n", { status: 404 });
    // AC-5: the tab the Deploy button's POST opened WAITS here, the same
    // way `spec-page.ts`'s own `?startTestServer=1` does — but this GET never
    // starts or restarts a board itself (the POST route already did, or
    // nobody ever pressed the button at all).
    if (url.searchParams.get("startTestServer") === "1") {
      const already = refreshTestServerStatus(ctx.testServers, name, MAIN_TEST_SERVER_KEY);
      if (already?.status === "running" && already.url) {
        return Response.redirect(testServerUrlFor(req, already.url), 303);
      }
      if (already?.status === "failed") {
        return testServerFailedPage(MAIN_TEST_SERVER_KEY, already.error);
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
    // Read fresh, uncached, exactly as `/projects` does: nothing polls
    // this page, so a scan per request is the cost `make generate`
    // already treats as cheap — and no invalidation to get wrong.
    const view = buildProjectViews(ctx.opts.projectRoot, ctx.ownedSpecsRoot).find((p) => p.name === name);
    if (!view) return new Response("no such project\n", { status: 404 });
    const dir = ctx.displayProjectDir(name);
    // Fail open, the way the drift check on `/projects` does. Every
    // check inside `assessProjectReadiness` already treats a git that
    // answers nothing as its own kind of failure rather than throwing,
    // so this catches the case where git is not there to be run at
    // all: the reader came for the project's page, and the half of it
    // that needs no git is still worth serving.
    const readiness = await assessProjectReadiness(ctx.gitRun, dir, ctx.machineryProjectDir(name)).catch(() => null);
    // Read-only, like `/projects`' own drift map: `peekDrift` is a
    // cache lookup, never a git call — the page's own "never merges,
    // pulls, fetches or checks anything out" contract
    // (project-detail-route.test.ts) must hold here too (spec 258).
    const driftRoot = ctx.machineryProjectDir(name);
    const drift = resolveInstallCmd(driftRoot).value
      ? ctx.branchStatus.peekDrift(driftRoot)
      : undefined;
    // Only meaningful for the one project this very process runs from —
    // every other project's checkout HEAD has nothing to do with this
    // server's own boot-time SHA, so the comparison stays undefined there.
    const { sha: servingSha, repoRoot: servingRepoRoot } = ctx.readServing();
    const serving =
      servingSha && servingRepoRoot && resolve(driftRoot) === resolve(servingRepoRoot)
        ? await (async () => {
            const head = await ctx.gitRun(driftRoot, ["rev-parse", "HEAD"]);
            if (head.code !== 0) return undefined;
            const checkoutHead = head.stdout.trim();
            const current = servingSha === checkoutHead;
            // REQ-7 (spec 392): only fetched while origin itself has not
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
          })().catch(() => undefined)
        : undefined;
    const langResult = languageChoice(url, req);
    const html = renderProjectPage(
      view,
      projectSettings(dir, readiness),
      readiness,
      new Date().toISOString(),
      ctx.nav(),
      {
        token: ctx.queueToken,
        script: await specsClientScript(),
        // Specs root and Worktree links are no longer read a second
        // time here (spec 255): `projectSettings(dir, readiness)`
        // above already resolved both, and the table draws its Value
        // cells straight off those same rows — one read per row's
        // data, not two that could drift.
        codeLanding: resolveCodeLanding(dir),
        // The one resolver, never a second copy of the question: two
        // would eventually disagree, and the one that decides where a
        // merge lands is not the one to get it wrong
        // (`git/branch-status.ts`).
        // `.catch`, like `readiness` above: a git that throws must leave
        // the page standing. A name nobody could fetch is no name, and
        // the choice falls back to the general word.
        defaultBranch: (await ctx.branchStatus.defaultBranch(dir).catch(() => null)) ?? undefined,
        schedule: resolveSchedule(dir),
        // The Schedule tab's own New-job form (spec 468) — the same
        // construction `schedule-pages.ts` already builds for the
        // aggregate page's own routes.
        modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([modelName, choice]) => ({
          name: modelName, budgetUsd: choice.budgetUsd, ...(choice.tool ? { tool: choice.tool } : {}),
        })),
        defaultModels: ctx.queue.defaults.model,
        worktreeLinkCandidates: gitignoreCandidates(dir),
        editing: url.searchParams.get("edit") === "1",
        error: url.searchParams.get("error") ?? undefined,
        drift,
        deployError: url.searchParams.get("deployError") ?? undefined,
        serving,
        restartWaiting: ctx.readPendingRestart()?.jobs,
        // AC-8: the same capability check the spec-page's own
        // test-server link already gates on.
        testServerAvailable: ctx.testServers.roundAvailable(name),
        tab: url.searchParams.get("tab") ?? undefined,
        lang: langResult.lang,
        currentUrl: langResult.currentUrl,
      },
    );
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  if (path === PROJECTS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    // No `--root`, no project set: an empty listing would read as "no
    // projects on this machine" rather than "this server was never
    // told where they are". The generated page is what such a server
    // has always shown, and it is still there.
    if (!ctx.opts.projectRoot) {
      return new Response(null, { status: 302, headers: { location: `/${OVERVIEW_PAGE}` } });
    }
    // Read fresh, uncached: unlike `/` nothing polls this page, so a
    // scan per request is the same cost `make generate` already treats
    // as cheap — and no invalidation to get wrong.
    const projects = buildProjectViews(ctx.opts.projectRoot, ctx.ownedSpecsRoot);
    // Spec 184: whether a run could start in each project, asked on
    // every visit. The Add flow answered this exactly once, in the
    // query string of the redirect it landed on — so an operator who
    // did not act on it there had no way to rediscover what was
    // missing except by starting a run and having it refused. Now the
    // row says it, and carries the Settings link that acts on it.
    // Concurrent, like the drift check above, and read-only.
    const readinessByProject: Record<string, boolean> = {};
    await Promise.all(
      projects.map(async (p) => {
        try {
          const { canRun } = await assessProjectReadiness(
            ctx.gitRun,
            ctx.displayProjectDir(p.name),
            ctx.machineryProjectDir(p.name),
          );
          readinessByProject[p.name] = canRun;
        } catch {
          // The listing is what the reader came for: a host with no
          // `git` on PATH must still get the page, and a row with
          // nothing to say about readiness is exactly the row the
          // generated page has always drawn.
          readinessByProject[p.name] = true;
        }
      }),
    );
    const langResult = languageChoice(url, req);
    const html = renderProjectsPage(
      projects,
      new Date().toISOString(),
      ctx.nav(),
      {
        readinessByProject,
        token: ctx.queueToken,
        // The RAW allowlist, like the New-spec dropdown: a project
        // with no spec yet is exactly what this page is for.
        createProjects: [...ctx.allowed].sort(),
        script: await specsClientScript(),
        error: url.searchParams.get("error") ?? undefined,
        // What the Add that landed the reader here found out (spec
        // 138). Straight from the query string, like the refusal
        // beside it, and rendered as text and nothing else.
        notice: url.searchParams.get("notice") ?? undefined,
        noticeOk: url.searchParams.get("noticeOk") === "1",
        lang: langResult.lang,
        currentUrl: langResult.currentUrl,
      },
    );
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    // The same one-time handover `/` does: projects.html passes the
    // address on with its query string, so a bookmarked token arrives
    // here.
    if (url.searchParams.get("token") && ctx.queueToken) {
      headers.append(
        "set-cookie",
        `aide_token_${ctx.serverPort()}=${encodeURIComponent(ctx.queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
      );
    }
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

  // Spec 272. Whatever a `schedule` step wrote to its own output
  // directory, served with the same `serveStatic()` primitive
  // `core-routes.ts` already uses for the generated site — pointed at a
  // different root. `scheduleOutputDir()` is the SAME function
  // `runner-setup.ts`'s spawn imports for the write side; a second
  // implementation of the join here would be the hand-paired-pair
  // failure mode `dashboard/CLAUDE.md` already names six instances of.

  return null;
}
