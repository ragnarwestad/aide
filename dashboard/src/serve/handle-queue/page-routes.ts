// Full-page GET routes and their redirects: the list, New spec,
// Settings, Add/Remove project, a project's own page, and the
// Projects listing. Extracted from handle-queue.ts (split of split
// serve.ts step 2).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildProjectViews, configValue, discoverUnclaimedDirectories, gitignoreCandidates, resolveCodeLanding, resolveSchedule } from "../../project/discover.ts";
import type { ScheduleEntry } from "../../project/parse-manifest.ts";
import { projectSettings } from "../../project/project-settings.ts";
import { assessProjectReadiness, suggestSpecsPath, suggestWorktreeLinksFromLockfile } from "../../project/project-admin.ts";
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, scheduleOutputDir, scheduleTrackingKey } from "../../queue/schedule.ts";
import { ADD_PROJECT_ROUTE, NEW_SPEC_ROUTE, OVERVIEW_PAGE, PROJECTS_ROUTE, SCHEDULE_ROUTE, SETTINGS_ROUTE, renderAddProjectPage, renderDeleteSchedulePage, renderNewSchedulePage, renderNewSpecPage, renderProjectPage, renderProjectsPage, renderQueuePage, renderQueueRows, renderRemoveProjectPage, renderScheduleDetailPage, renderSchedulePage, renderSettingsPage, resolveBackHref, type ProjectDrift } from "../../render.ts";
import { queueClientScript, sortChoice } from "../serve-helpers.ts";
import { serveStatic } from "../serve-helpers/static.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

export async function handlePageRoutes(
  ctx: HandleQueueContext,
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
    const chosenState = url.searchParams.get("state") ?? undefined;
    // Every archived spec is a row on this list since spec 221 — but
    // only for a reader whose chip asks for one. The builder decides
    // that itself, off the same `filterShowsArchived` the chips are
    // defined by, and the scale question is why: aide alone archives
    // about 150 specs, this page rebuilds itself on every change
    // event on every open tab, and the default view must not pay for
    // a set it does not show.
    const archivedSpecs = ctx.archivedSpecRows(chosenState);
    // The reader's own choice of column, from the address or from the
    // cookie it was last written into.
    const chosenSort = sortChoice(url, req);
    const view = {
      runnerAvailable: ctx.opts.runnerAvailable ?? ctx.runner !== null,
      targets: liveTargets,
      archived: archivedKeys,
      archivedSpecs,
      script: await queueClientScript(),
      // Only what the config granted a budget to is offerable: a
      // dropdown naming a model the machine has not agreed to pay for
      // would be a way around the caps.
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, c]) => ({
        name,
        budgetUsd: c.budgetUsd,
        // Carried so the option can SAY which CLI it starts: two
        // entries that differ only in that would otherwise be two
        // identical-looking names in the same dropdown.
        ...(c.tool ? { tool: c.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      error: url.searchParams.get("error") ?? undefined,
      // Which row the refusal belongs to. It rides in the query
      // string with the reason itself, so it survives the
      // five-second row swap the same way the filter does.
      errorSpec: url.searchParams.get("errorSpec") ?? undefined,
      projects: [...new Set(liveTargets.map((t) => t.project))].sort(),
      // The raw allowlist, not the discovered set: a project whose
      // FIRST spec this form exists to make has nothing on disk to be
      // discovered from, so deriving these from `targets()` would
      // leave it out of the one dropdown it needs to be in. Every
      // other list on this page stays derived, because every other
      // control is about a spec that already exists.
      createProjects: [...ctx.allowed].sort(),
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
    const listed = ctx.queue.list().filter((j) => ctx.allowed.has(j.project) && !j.specFolder.startsWith("schedule-"));
    if (url.searchParams.get("rows")) {
      // The sort cookie is written HERE as well as on the whole page,
      // and this is the one that matters: pressing a column heading
      // never reloads the page. The script rewrites the address and
      // fetches these rows alone, so a cookie set only on the full
      // page would never be written by the very act of choosing.
      const rowHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
      if (chosenSort.setCookie) rowHeaders.append("set-cookie", chosenSort.setCookie);
      return new Response(renderQueueRows(await Promise.all(listed.map(ctx.jobRow)), view), {
        headers: rowHeaders,
      });
    }
    const html = renderQueuePage(
      await Promise.all(listed.map(ctx.jobRow)),
      new Date().toISOString(),
      ctx.nav(),
      view,
    );
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    // Hand the token over ONCE, as an HttpOnly cookie, so the forms
    // never have to carry it in their markup.
    //
    // `Lax`, not `Strict` (2026-08-22). A Strict cookie is withheld on
    // a top-level navigation that STARTED somewhere else, and an
    // installed app launched from the home screen is exactly that — so
    // the dashboard installed on a phone opened on "unauthorized"
    // while the same browser was signed in. Lax is sent on an ordinary
    // top-level navigation and still withheld from a cross-site POST,
    // which is what Strict was guarding here; every form on this page
    // posts same-site and is unaffected.
    // A `Headers` rather than the record it was built from: two
    // cookies can be handed over on one response — the token on the
    // first visit and the sort a shared link carried — and a record
    // has room for one `set-cookie`.
    const pageHeaders = new Headers(headers);
    if (url.searchParams.get("token") && ctx.queueToken) {
      pageHeaders.append(
        "set-cookie",
        `aide_token=${encodeURIComponent(ctx.queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
      );
    }
    if (chosenSort.setCookie) pageHeaders.append("set-cookie", chosenSort.setCookie);
    return new Response(html, { headers: pageHeaders });
  }

  if (path === NEW_SPEC_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const html = renderNewSpecPage(ctx.nav(), new Date().toISOString(), {
      token: ctx.queueToken,
      createProjects: [...ctx.allowed].sort(),
      targets: ctx.withFreshness(ctx.targets()),
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      script: await queueClientScript(),
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name,
        budgetUsd: choice.budgetUsd,
        ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      // Why the last submission was refused, carried back here by the
      // create route's own redirect.
      error: url.searchParams.get("error") ?? undefined,
    });
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    // The same one-time handover `/` and `/projects` do, for a reader
    // who arrived with the token in the address.
    if (url.searchParams.get("token") && ctx.queueToken) {
      headers["set-cookie"] =
        `aide_token=${encodeURIComponent(ctx.queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
    }
    return new Response(html, { headers });
  }

  if (path === SETTINGS_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return new Response(renderSettingsPage(ctx.nav(), new Date().toISOString(), {
      modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
        name, budgetUsd: choice.budgetUsd, ...(choice.tool ? { tool: choice.tool } : {}),
      })),
      defaultModels: ctx.queue.defaults.model,
      budgetUsd: ctx.queue.defaults.budgetUsd,
      jobCapUsd: ctx.queue.defaults.jobCapUsd,
      timeoutSec: ctx.queue.defaults.timeoutSec,
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      script: await queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      notice: url.searchParams.get("notice") ?? undefined,
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  if (path === ADD_PROJECT_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    if (!ctx.opts.projectRoot) {
      return new Response(null, { status: 302, headers: { location: `/${OVERVIEW_PAGE}` } });
    }
    // Read fresh per request, the way /projects reads its own scan:
    // a checkout that appeared on the host a minute ago is offered.
    const unclaimed = discoverUnclaimedDirectories(ctx.opts.projectRoot);
    const html = renderAddProjectPage(ctx.nav(), new Date().toISOString(), {
      token: ctx.queueToken,
      script: await queueClientScript(),
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
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
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
    const html = renderRemoveProjectPage(name, ctx.nav(), new Date().toISOString(), {
      token: ctx.queueToken,
      script: await queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
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
    const drift = configValue(driftRoot, "AIDE_INSTALL_CMD")
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
            return { sha: servingSha, checkoutHead, current: servingSha === checkoutHead };
          })().catch(() => undefined)
        : undefined;
    const html = renderProjectPage(
      view,
      projectSettings(dir, readiness),
      readiness,
      new Date().toISOString(),
      ctx.nav(),
      {
        token: ctx.queueToken,
        script: await queueClientScript(),
        // Specs root and Worktree links are no longer read a second
        // time here (spec 255): `projectSettings(dir, readiness)`
        // above already resolved both, and the table draws its Value
        // cells straight off those same rows — one read per row's
        // data, not two that could drift.
        codeLanding: resolveCodeLanding(dir),
        schedule: resolveSchedule(dir),
        worktreeLinkCandidates: gitignoreCandidates(dir),
        editing: url.searchParams.get("edit") === "1",
        error: url.searchParams.get("error") ?? undefined,
        drift,
        deployError: url.searchParams.get("deployError") ?? undefined,
        serving,
        tab: url.searchParams.get("tab") ?? undefined,
      },
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
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
    // Spec 142: a merge made anywhere but the Merge button below ran
    // no `AIDE_INSTALL_CMD`, so the serving host is still serving the
    // old code and, until this asked, nothing said so. Asked only of
    // the projects that expect an install to have happened —
    // deploying is a known hand step where none is configured, and a
    // banner there would be noise on every row forever.
    //
    // Kept out of `buildProjectViews`, which stays a pure disk scan
    // the static generator shares.
    //
    // Spec 203: a read, and nothing else. `peekDrift` is a map
    // lookup — no await, no git, no network on this path ever. The
    // taking of the answer is `refreshDrift`'s job on its own
    // schedule; what a row shows here is the last one it found, with
    // its own timestamp so the page can say how old it is. A project
    // gated for the check but never yet answered for is a key with a
    // null `checkedAt`, which the row says out loud.
    const driftByProject: Record<string, ProjectDrift> = {};
    for (const p of projects) {
      const root = ctx.machineryProjectDir(p.name);
      if (configValue(root, "AIDE_INSTALL_CMD")) {
        driftByProject[p.name] = ctx.branchStatus.peekDrift(root);
      }
    }
    // Spec 259: straight off each project's already-parsed manifest —
    // no read of its own, and no schedule to keep it current, since
    // `nextFireTime` below is pure arithmetic against the page's own
    // clock rather than a network question.
    const scheduleByProject: Record<string, readonly ScheduleEntry[]> = {};
    for (const p of projects) {
      if (p.manifest.ok && p.manifest.data.schedule?.length) scheduleByProject[p.name] = p.manifest.data.schedule;
    }
    // Spec 184: whether a run could start in each project, asked on
    // every visit. The Add flow answered this exactly once, in the
    // query string of the redirect it landed on — so an operator who
    // did not act on it there had no way to rediscover what was
    // missing except by starting a run and having it refused. Now the
    // row says it, and carries the Settings link that acts on it.
    // Concurrent, like the drift check above, and read-only.
    const readinessByProject: Record<string, { canRun: boolean; note: string }> = {};
    await Promise.all(
      projects.map(async (p) => {
        try {
          const { canRun, note } = await assessProjectReadiness(
            ctx.gitRun,
            ctx.displayProjectDir(p.name),
            ctx.machineryProjectDir(p.name),
          );
          readinessByProject[p.name] = { canRun, note };
        } catch {
          // A note is advice, and the listing is what the reader came
          // for: a host with no `git` on PATH must still get the page,
          // and a row with nothing to say about readiness is exactly
          // the row the generated page has always drawn.
          readinessByProject[p.name] = { canRun: true, note: "" };
        }
      }),
    );
    const html = renderProjectsPage(
      projects,
      new Date().toISOString(),
      ctx.nav(),
      {
        driftByProject,
        scheduleByProject,
        readinessByProject,
        token: ctx.queueToken,
        // The RAW allowlist, like the New-spec dropdown: a project
        // with no spec yet is exactly what this page is for.
        createProjects: [...ctx.allowed].sort(),
        script: await queueClientScript(),
        error: url.searchParams.get("error") ?? undefined,
        // What the Add that landed the reader here found out (spec
        // 138). Straight from the query string, like the refusal
        // beside it, and rendered as text and nothing else.
        notice: url.searchParams.get("notice") ?? undefined,
        noticeOk: url.searchParams.get("noticeOk") === "1",
      },
    );
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    // The same one-time handover `/` does: projects.html passes the
    // address on with its query string, so a bookmarked token arrives
    // here.
    if (url.searchParams.get("token") && ctx.queueToken) {
      headers["set-cookie"] =
        `aide_token=${encodeURIComponent(ctx.queueToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
    }
    return new Response(html, { headers });
  }

  // Spec 272. Whatever a `schedule` step wrote to its own output
  // directory, served with the same `serveStatic()` primitive
  // `core-routes.ts` already uses for the generated site — pointed at a
  // different root. `scheduleOutputDir()` is the SAME function
  // `runner-setup.ts`'s spawn imports for the write side; a second
  // implementation of the join here would be the hand-paired-pair
  // failure mode `dashboard/CLAUDE.md` already names six instances of.
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
