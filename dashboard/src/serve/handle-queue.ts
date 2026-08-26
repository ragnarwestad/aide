// The route handler for every /queue and /api/queue path, and the
// pages that live beside it ("New spec", Settings, Add/Remove
// project, a spec's own save/tick/reset routes). Extracted from
// `createServer` (spec: split serve.ts, step 2) — it is the single
// largest piece of that closure, and unlike `serve-helpers.ts` it is
// NOT closure-free: everything it used to read off `createServer`'s
// local scope now arrives explicitly through `ctx`, built once by
// `createServer` itself.
import { join } from "node:path";
import type { GitRunner } from "../git/branch-status.ts";
import type { BranchStatusChecker } from "../git/branch-status.ts";
import { fastForwardToOrigin, type RepoMergeResult } from "../git/branch-merge.ts";
import { pullFastForward, saveSpecFiles } from "../git/specs-pull.ts";
import type { DashboardCheckout } from "../git/dashboard-checkout.ts";
import {
  buildProjectViews, configValue, discoverProjects, discoverUnclaimedDirectories,
  gitignoreCandidates, resolveCodeLanding, resolveSchedule, specFileText, withDependsOnLine,
  type SpecRef,
} from "../project/discover.ts";
import type { ScheduleEntry } from "../project/parse-manifest.ts";
import { projectSettings } from "../project/project-settings.ts";
import {
  clearArchiveHeldBack, parseStatusChecks, tickStatusLine,
} from "../project/parse-status.ts";
import {
  persistQueueSettings,
  type Job, type QueueStore,
} from "../queue/queue.ts";
import {
  addProject,
  addProjectTarget,
  assessProjectReadiness,
  projectNameError,
  removeProject,
  suggestSpecsPath,
  suggestWorktreeLinksFromLockfile,
  updateProjectSettings,
  type ProjectReadiness,
  type ProjectStep,
} from "../project/project-admin.ts";
import type { Runner } from "../queue/runner.ts";
import {
  ADD_PROJECT_ROUTE,
  FROM_LIST_FIELD,
  NEW_SPEC_ROUTE,
  OVERVIEW_PAGE,
  PROJECTS_ROUTE,
  SETTINGS_ROUTE,
  SETTINGS_STEPS,
  EDITABLE_SPEC_FILE,
  STATUS_SPEC_FILE,
  renderAddProjectPage,
  renderJobDetailPage,
  renderNewSpecPage,
  renderProjectPage,
  renderProjectsPage,
  renderQueuePage,
  renderQueueRows,
  renderRemoveProjectPage,
  renderResetSpecPage,
  renderSettingsPage,
  renderSpecPage,
  resolveBackHref,
  specPagePath,
  specTabPath,
  type ArchivedSpecView,
  type JobDetailView,
  type NavEntry,
  type ProjectDrift,
  type QueueRowView,
  type QueueTarget,
  type SpecPageView,
} from "../render.ts";
import {
  ARCHIVED_REFUSAL, MAX_SAVE_BODY,
  bodyToObject, editMessage, json, logRefusal, queueClientScript, readBounded,
  resolveDependencyFolder, sortChoice, specsRedirect, tickMessage,
  type createRootLock,
} from "./serve-helpers.ts";
import type { ServerOptions } from "./serve.ts";

/** Everything `handleQueue` used to read off `createServer`'s own
 *  closure, bundled so the function can live outside it. `createServer`
 *  builds one of these once, from the exact same locals it always had,
 *  and hands it to every call. `scan` is the one piece of MUTABLE
 *  closure state this function touches (it reads the current scan and
 *  invalidates it after a save/tick/create), so it is threaded through
 *  as a getter/invalidator pair rather than a value — a plain field
 *  would have captured whatever `scan` was at context-build time and
 *  never seen a later refresh. */
export interface HandleQueueContext {
  opts: ServerOptions;
  nav: () => NavEntry[];
  allowed: Set<string>;
  readScan: () => { archived: string[] } | null;
  invalidateScan: () => void;
  targets: () => QueueTarget[];
  withFreshness: (list: QueueTarget[]) => QueueTarget[];
  specDir: (project: string, specFolder: string) => string | undefined;
  specRef: (project: string, specFolder: string) => SpecRef | undefined;
  specsRoot: (dir: string) => Promise<string>;
  machinerySpecDir: (project: string, dir: string) => Promise<string>;
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
  writeTo: (c: ReadableStreamDefaultController<Uint8Array>, text: string) => void;
  queue: QueueStore;
  displayProjectDir: (project: string) => string;
  machineryProjectDir: (project: string) => string;
  ownedSpecsRoot: (project: string) => string | undefined;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
  gitRun: GitRunner;
  branchStatus: BranchStatusChecker;
  mergeLock: ReturnType<typeof createRootLock>;
  runner: Runner | null;
  tickRunner: () => Promise<void>;
  queueToken: string | undefined;
  jobRow: (job: ReturnType<QueueStore["list"]>[number]) => Promise<QueueRowView>;
  installAfterMerge: (result: RepoMergeResult) => Promise<void>;
  persistAllowlist: (what: string) => ProjectStep;
  answerProjectChange: (
    action: string,
    project: string,
    steps: ProjectStep[],
    sent: unknown,
    wantsJson: boolean,
    readiness?: ProjectReadiness,
  ) => Response;
  archivedSpecRows: (state: string | undefined) => ArchivedSpecView[];
  specPageView: (project: string, specFolder: string, tab?: string) => Promise<SpecPageView | null>;
  jobDetailView: (job: Job) => Promise<JobDetailView>;
}

export async function handleQueue(ctx: HandleQueueContext, req: Request, url: URL, path: string): Promise<Response> {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

  // The list is the dashboard's front page. Both addresses it used to
  // answer at keep answering, because people bookmark this page — and
  // the token arrives in the query string of exactly such a bookmark,
  // so the search goes on verbatim. `/api/queue*` is an API contract
  // and is deliberately not matched.
  if (path === "/queue" || path === "/specs") {
    return new Response(null, { status: 302, headers: { location: `/${url.search}` } });
  }

  // Spec 189: the page's own connection. Answered HERE, near the top,
  // and deliberately not further down beside the other `/api/queue`
  // routes: the `/(api\/queue|specs)/<id>` match at the end of this
  // function would read "events" as a job id and answer 404 for a
  // route that exists.
  if (path === "/api/queue/events") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        mine = controller;
        ctx.watchers.add(controller);
        // The subscriber is registered — say so. A caller that acts
        // the instant its `fetch` resolves would otherwise race the
        // registration and wait for an event that was broadcast
        // before it was listening. A comment, so no client sees it.
        ctx.writeTo(controller, ": open\n\n");
      },
      cancel() {
        if (mine) ctx.watchers.delete(mine);
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Nothing serves this through a proxy today, but one that
        // buffered would hold every event back until the connection
        // closed — which is the whole of what this route is for.
        "x-accel-buffering": "no",
      },
    });
  }

  // The DETAIL page did not move with the list: what sits at the end
  // of this path is a job id, and a job is still read at /specs/<id>.
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
      script: queueClientScript(),
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
    const listed = ctx.queue.list().filter((j) => ctx.allowed.has(j.project));
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

  // The New-spec form's own page (spec 121). It was a disclosure on
  // `/` until the button that opened it became a link to here.
  //
  // It needs three things off this server and no more: which projects
  // a spec may be made in (the RAW allowlist, like the dropdown it
  // feeds — a project whose FIRST spec this form exists to make has
  // nothing on disk to be discovered from), what the new spec may
  // build on, and the page code that scopes the second to the first.
  if (path === NEW_SPEC_ROUTE) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const html = renderNewSpecPage(ctx.nav(), new Date().toISOString(), {
      token: ctx.queueToken,
      createProjects: [...ctx.allowed].sort(),
      targets: ctx.withFreshness(ctx.targets()),
      backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      script: queueClientScript(),
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
      script: queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
      notice: url.searchParams.get("notice") ?? undefined,
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // The Add-project form on a page of its own, and the Remove
  // confirmation likewise (2026-08-19, New spec as the pattern). Both
  // only exist where /projects itself does — without --root there is
  // nothing to add to.
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
      script: queueClientScript(),
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
      script: queueClientScript(),
      error: url.searchParams.get("error") ?? undefined,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // The former Settings page redirects to the single editing surface.
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

  // A project's OWN page, served (spec 185). Below the Add and Remove
  // pages on purpose: those are two-segment paths too, and a project
  // may not shadow a control.
  //
  // The generated `<slug>.html` is still written and still reachable
  // — a site rsynced behind a plain file server has no server to ask
  // git anything, and that is the deployment it is for. What that
  // page cannot say is what this one exists for: the config file is
  // personal and gitignored, an operator edits it between merges, and
  // the generator runs only after some unrelated merge lands in the
  // queue.
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
    const html = renderProjectPage(
      view,
      projectSettings(dir, readiness),
      readiness,
      new Date().toISOString(),
      ctx.nav(),
      {
        token: ctx.queueToken,
        script: queueClientScript(),
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
      },
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // The projects page (spec 115): the same listing the generator used
  // to write to projects.html, plus the panel that changes it. Beside
  // the `/` branch above on purpose — the full-page GET handlers
  // belong together for anyone reading this function.
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
        script: queueClientScript(),
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

  // Before the `<id>/<verb>` and `<id>` matches below, which would
  // otherwise read "create" as a job id and answer 404 for it.
  if (path === "/api/queue/create") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const result = ctx.queue.enqueueCreate(raw);
    // The two no-JS answers go to different pages on purpose (spec
    // 121). A refusal goes back to the page the form is ON, where
    // what was typed can be corrected — the same rule the Projects
    // panel's own routes follow. A success goes to the list, because
    // the thing the reader asked for is a row on it.
    if (!result.ok) {
      return wantsJson
        ? json({ error: result.error }, 400)
        : specsRedirect(raw, { error: result.error }, NEW_SPEC_ROUTE);
    }
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw, undefined, "/");
  }

  if (path === "/api/queue/settings") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try { raw = bodyToObject(body.text, req.headers.get("content-type")); }
    catch { return json({ error: "malformed body" }, 400); }
    const asked = raw as Record<string, unknown> | null;
    const models = asked?.model;
    const refuse = (error: string) => wantsJson
      ? json({ error }, 400)
      : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?error=${encodeURIComponent(error)}` } });
    if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
    if (!models || typeof models !== "object" || Array.isArray(models)) return refuse("model defaults are missing");
    const table = models as Record<string, unknown>;
    const unknown = Object.keys(table).find((step) => !(SETTINGS_STEPS as readonly string[]).includes(step));
    if (unknown) return refuse(`unknown workflow step: ${unknown}`);
    const next: Record<string, string> = {};
    for (const step of SETTINGS_STEPS) {
      const value = table[step];
      if (Array.isArray(value)) return refuse(`duplicate model value for ${step}`);
      if (typeof value !== "string" || !value) return refuse(`missing model for ${step}`);
      if (!ctx.queue.defaults.modelChoices?.[value]) return refuse(`unknown or not-allowed model for ${step}: ${value}`);
      next[step] = value;
    }

    // budgetUsd/jobCapUsd/timeoutSec: the ceilings a per-job request
    // can only tighten (`tighten()` above), never loosen — these
    // ranges catch an operator's typo well above the highest value
    // already live in production (spec 250's own analysis: $35).
    const numField = (v: unknown, name: string, min: number, max: number): number | { error: string } => {
      if (typeof v !== "number" || !Number.isFinite(v)) return { error: `invalid ${name}` };
      if (v < min || v > max) return { error: `${name} must be between ${min} and ${max}` };
      return v;
    };
    const budgetUsd = numField(asked?.budgetUsd, "budgetUsd", 0.01, 100);
    if (typeof budgetUsd !== "number") return refuse(budgetUsd.error);
    const jobCapUsd = numField(asked?.jobCapUsd, "jobCapUsd", 0.01, 300);
    if (typeof jobCapUsd !== "number") return refuse(jobCapUsd.error);
    if (jobCapUsd < budgetUsd) return refuse("jobCapUsd may not be lower than budgetUsd");

    const askedTimeout = asked?.timeoutSec;
    if (!askedTimeout || typeof askedTimeout !== "object" || Array.isArray(askedTimeout)) {
      return refuse("timeoutSec is missing");
    }
    const minutesTable = askedTimeout as Record<string, unknown>;
    const timeoutSec: Record<string, number> = {};
    for (const step of SETTINGS_STEPS) {
      // Minutes on this route (matching the form and the existing
      // render/job-state.ts:145 display convention) — converted to
      // seconds, the unit every reader of `queue.defaults.timeoutSec`
      // already expects.
      const minutes = numField(minutesTable[step], `timeoutSec.${step}`, 1, 360);
      if (typeof minutes !== "number") return refuse(minutes.error);
      timeoutSec[step] = minutes * 60;
    }

    const merged = { ...ctx.queue.defaults.model, ...next };
    const error = persistQueueSettings(ctx.opts.queueConfigFile, { model: next, budgetUsd, jobCapUsd, timeoutSec });
    if (error) return refuse(error);
    ctx.queue.defaults.model = merged;
    ctx.queue.defaults.budgetUsd = budgetUsd;
    ctx.queue.defaults.jobCapUsd = jobCapUsd;
    ctx.queue.defaults.timeoutSec = { ...ctx.queue.defaults.timeoutSec, ...timeoutSec };
    return wantsJson
      ? json({ ok: true, model: next, budgetUsd, jobCapUsd, timeoutSec })
      : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?notice=${encodeURIComponent("Defaults saved")}` } });
  }

  // --- the project allowlist (spec 112) -----------------------------
  //
  // Before the `<id>/<verb>` and `<id>` matches below, which would
  // otherwise read "projects" as a job id and answer 404 for it —
  // the same reason `/api/queue/create` sits above them.
  //
  // Both routes are under `/api/queue/`, so `isQueuePath()` already
  // guards them: a sibling `/api/projects/*` would have been exactly
  // the silent bypass that predicate exists to prevent.
  if (path === "/api/queue/projects") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const asked = (raw ?? {}) as Record<string, unknown>;
    const text = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const rawName = typeof asked.name === "string" ? asked.name : "";
    // The picked checkout settles the project's name when Name was
    // left blank (spec 131), and the ALLOWLIST is what that name is
    // for — so the rule is asked of `project-admin.ts` here rather
    // than copied, and the answer names the project that was added.
    const name = addProjectTarget(ctx.opts.projectRoot ?? "", {
      name: rawName,
      existingPath: text(asked.existingPath),
    }).name || rawName;
    // Adding a project means putting a directory under the projects
    // root, and without `--root` there is no such root: refused in
    // those words rather than half-done somewhere arbitrary.
    if (!ctx.opts.projectRoot) {
      return ctx.answerProjectChange(
        "add-project",
        name,
        [{ step: "name", ok: false, error: "this server was started without --root, so it has no projects root to add to" }],
        raw,
        wantsJson,
      );
    }
    const result = await addProject(ctx.gitRun, ctx.opts.projectRoot, {
      name: rawName,
      gitUrl: text(asked.gitUrl),
      existingPath: text(asked.existingPath),
      description: text(asked.description),
      specsPath: text(asked.specsPath),
      worktreeLinks: text(asked.worktreeLinks),
    });
    const steps = [...result.steps];
    let readiness = result.readiness;
    if (result.ok) {
      ctx.allowed.add(name);
      // The five-second scan is what every other list on this page
      // reads; without this the very request after an Add would still
      // not see the project.
      ctx.invalidateScan();
      steps.push(ctx.persistAllowlist("added to the allowlist"));
      // Spec 205: eagerly, and here rather than inside `addProject` —
      // the alternative is every project's first run, Save or Update
      // paying a full clone inside the request that happens to need
      // one, which is a latency regression nobody asked for. The
      // readiness is re-taken afterwards so the answer describes the
      // checkout that now exists, not the one that did not a moment
      // ago.
      await ctx.ensureCheckout(name);
      readiness = await assessProjectReadiness(
        ctx.gitRun,
        join(ctx.opts.projectRoot, name),
        ctx.machineryProjectDir(name),
      ).catch(() => readiness ?? undefined);
    }
    // Only for an add that got as far as writing its files: there is
    // nothing to assess in a clone that never happened, and a
    // readiness answer about a project that was not added would be an
    // answer about somebody else's directory.
    return ctx.answerProjectChange("add-project", name, steps, raw, wantsJson, readiness);
  }

  // Spec 184: the same two fields the Add form posts, for a project
  // that already exists. Above the `<id>/<verb>` matches for the same
  // reason the Add route is.
  const settingsPost = path.match(/^\/api\/queue\/projects\/([^/]+)\/settings$/);
  if (settingsPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(settingsPost[1]!);
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return ctx.answerProjectChange(
        "project-settings",
        name,
        [{ step: "name", ok: false, error: `"${name}" is not a project this dashboard knows` }],
        raw,
        wantsJson,
      );
    }
    const asked = (raw ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const result = await updateProjectSettings(ctx.gitRun, join(ctx.opts.projectRoot, name), {
      specsPath: str(asked.specsPath),
      worktreeLinks: str(asked.worktreeLinks),
      // Only when the form actually sent one (spec 220, then 255 for
      // the two that joined it): a caller posting only the older
      // fields must not be read as clearing the ones it never
      // mentioned.
      ...("codeLanding" in asked && { codeLanding: str(asked.codeLanding) }),
      ...("installCmd" in asked && { installCmd: str(asked.installCmd) }),
      ...("jiraBaseUrl" in asked && { jiraBaseUrl: str(asked.jiraBaseUrl) }),
    });
    // The specs root a save just named is where the scan goes looking
    // for this project's specs — without this the very next request
    // would still read the old one.
    if (result.ok) ctx.invalidateScan();
    // And it is what `aide-run-spec` reads out of the DASHBOARD's own
    // checkout (spec 205): the write above reached the person's
    // config, and `ensureCheckout` is what carries the new value
    // across. Without this the next run would still read the old
    // specs root — silently, which is the whole hazard of two config
    // files.
    const readiness = result.ok
      ? await ctx.ensureCheckout(name).then(() =>
          assessProjectReadiness(ctx.gitRun, join(ctx.opts.projectRoot!, name), ctx.machineryProjectDir(name)).catch(
            () => result.readiness,
          ),
        )
      : result.readiness;
    return ctx.answerProjectChange("project-settings", name, result.steps, raw, wantsJson, readiness);
  }

  // Spec 258: the button behind the drift note on a project's own
  // page. Answered directly rather than through
  // `answerProjectChange`/`ProjectStep[]` — that machinery's `ok =
  // steps.every(...)` does not fit `installAfterMerge`'s own "a
  // failed install never turns a landed change back into a failure"
  // rule. A pull failure refuses outright (the checkout did not
  // move); an install failure is reported beside a real success (the
  // checkout DID move, so the drift count is refreshed either way).
  const deployPost = path.match(/^\/api\/queue\/projects\/([^/]+)\/deploy$/);
  if (deployPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(deployPost[1]!);
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    const refuse = (error: string): Response => {
      logRefusal("project-deploy", name, error);
      return wantsJson
        ? json({ ok: false, error }, 400)
        : new Response(null, {
            status: 303,
            headers: { location: `/projects/${encodeURIComponent(name)}?deployError=${encodeURIComponent(error)}` },
          });
    };
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return refuse(`"${name}" is not a project this dashboard knows`);
    }
    const root = ctx.machineryProjectDir(name);
    if (!configValue(root, "AIDE_INSTALL_CMD")) {
      return refuse(`${name} has no AIDE_INSTALL_CMD configured — deploying stays a hand step`);
    }
    const base = await ctx.branchStatus.defaultBranch(root);
    if (!base) return refuse(`cannot work out the default branch in ${root}`);
    const result = await ctx.mergeLock.run(root, () => fastForwardToOrigin(ctx.gitRun, root, base));
    if (!result.ok) return refuse(result.error ?? `cannot bring ${root} up to date`);
    await ctx.installAfterMerge(result);
    // Fresh, not cached: the checkout just moved, and the next reader
    // of this project's page must not see the old count for up to
    // driftPollMs longer.
    await ctx.branchStatus.commitsBehindOrigin(root, true);
    if (result.installError) {
      console.error(`queue: deploy ${name} in ${root} — ${result.installError}`);
      return wantsJson
        ? json({ ok: true, installError: result.installError })
        : new Response(null, {
            status: 303,
            headers: {
              location: `/projects/${encodeURIComponent(name)}?deployError=${encodeURIComponent(result.installError)}`,
            },
          });
    }
    return wantsJson
      ? json({ ok: true })
      : new Response(null, { status: 303, headers: { location: `/projects/${encodeURIComponent(name)}` } });
  }

  const removal = path.match(/^\/api\/queue\/projects\/([^/]+)\/remove$/);
  if (removal) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(removal[1]!);
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const nameError = projectNameError(name);
    if (nameError) {
      return ctx.answerProjectChange("remove-project", name, [{ step: "name", ok: false, error: nameError }], raw, wantsJson);
    }
    const asked = (raw ?? {}) as Record<string, unknown>;
    const result = removeProject(ctx.allowed, { name, confirm: asked.confirm });
    const steps = [...result.steps];
    if (result.ok) {
      ctx.invalidateScan();
      // `removeProject` already reported the allowlist step; this
      // replaces it with the same step told from the other side of the
      // write, rather than reporting the one thing twice.
      steps[steps.length - 1] = ctx.persistAllowlist("removed from the allowlist");
    }
    return ctx.answerProjectChange("remove-project", name, steps, raw, wantsJson);
  }

  if (path === "/api/queue") {
    if (req.method === "GET") {
      return json({ generatedAt: new Date().toISOString(), jobs: ctx.queue.list() });
    }
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // Where a no-script form POST comes back to: the page the press
    // came FROM, because a redirect is the only answer such a form
    // gets and a reader dropped somewhere else cannot tell whether the
    // button did anything (spec 157).
    //
    // Reopen is the one control offered in two places (spec 198, and
    // spec 221 for the row). An archived spec's own page still gets
    // its answer there; a press on the list's own reader row says so
    // with `FROM_LIST_FIELD` and is answered on the list, filter and
    // all — `specsRedirect` rebuilds the view from the `view.*` fields
    // the same form carries. The marker is what decides it, never a
    // destination taken from the browser.
    const askedFor = raw as Record<string, unknown> | null;
    const backTo =
      askedFor?.[FROM_LIST_FIELD] !== "1" &&
      typeof askedFor?.project === "string" &&
      typeof askedFor?.specFolder === "string" &&
      ctx.specRef(askedFor.project, askedFor.specFolder)?.archived
        ? specPagePath(askedFor.project, askedFor.specFolder)
        : "/";
    const result = ctx.queue.enqueue(raw);
    if (!result.ok) {
      // Which spec was asked for, off the SUBMITTED fields — the two
      // `parseJobRequest` already requires, so this adds no trust
      // surface. It is never rendered as text either: the page only
      // compares it against a row's own key.
      const asked = raw as Record<string, unknown> | null;
      const spec =
        typeof asked?.project === "string" && typeof asked?.specFolder === "string"
          ? `${asked.project}/${asked.specFolder}`
          : undefined;
      logRefusal("run", spec, result.error);
      // A person who pressed a button gets the reason on the page
      // they pressed it from; an API caller gets a status code.
      // `spec` for the same reason merge's answer carries it: the page
      // shows a refusal on the row it belongs to and no longer
      // navigates to find out which, so the answer has to say.
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(raw, { error: result.error, spec }, backTo);
    }
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw, undefined, backTo);
  }

  // Spec 149: `cancel` is what is left of a route that also had
  // `approve` and `merge`. Both were removed with the things they
  // acted on — there is no stop between steps to approve, and every
  // step lands its own work, so there is nothing left to merge by
  // hand. Cancelling a run is the one action on a row that was never
  // about either.
  const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/cancel$/);
  if (action) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = action;
    const job = ctx.queue.get(id);
    if (!job) return json({ error: "no such job" }, 404);
    // The body is read for ONE thing: the view the press came from,
    // so the redirect can put the reader back on it. A JSON caller
    // sends no body at all, and an unparseable one is not a reason to
    // refuse an action that needs nothing from it.
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let view: unknown = {};
    try {
      if (sent.text) view = bodyToObject(sent.text, req.headers.get("content-type"));
    } catch {
      view = {};
    }
    // SIGTERM to the GROUP, never a bare pid: claude spawns
    // children, and a kill that only reaches the parent is not a
    // bound.
    if (job.pgid !== undefined) {
      try {
        process.kill(-job.pgid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    ctx.queue.update(id, { state: "cancelled", finishedAt: new Date().toISOString() });
    return wantsJson ? json({ ok: true, job: ctx.queue.get(id) }) : specsRedirect(view);
  }

  // Spec 160: an edit to the job that is RUNNING, not a request for a
  // new one. `POST /api/queue` would be the wrong door — its answer
  // for a spec with a job in flight is the clash refusal, and rightly
  // — so the tail gets a route of its own, named after what it does.
  //
  // Every decision is the store's, against the job as it stands at
  // that instant: the page's idea of which step is running is a
  // second old by the time the tick lands, and it is never consulted.
  const tailEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/steps$/);
  if (tailEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    // A form sends the tick as text, an API caller as a boolean. Both
    // say the same thing, and the box's own state is what they say:
    // ticked adds the step, unticked removes it.
    const checked = body.checked;
    const add =
      checked === true ||
      (typeof checked === "string" && ["1", "true", "on", "yes"].includes(checked.toLowerCase()));
    const spec = `${job.project}/${job.specFolder}`;
    const result = ctx.queue.editTailStep(id!, step, add);
    if (!result.ok) {
      logRefusal("steps", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(body, { error: result.error, spec });
    }
    // Now, not on the next two-second timer: a step added in the
    // instant the running one finishes would otherwise wait for it.
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
  }

  // Spec 225: the same edit for the other two controls on a phase
  // line. A sibling route rather than a second field on `/steps`,
  // because a box tick and a select change are two different events
  // at two different moments — one body carrying both would have to
  // branch on which fields it was handed, and `checked`'s absence
  // would have to start meaning something other than `false`.
  //
  // It queues nothing, so no tick is asked for: the runner reads
  // `job.model[step]` fresh when it spawns the step, which is what
  // makes the pick apply without an "apply" mechanism of its own.
  const tailModelEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/model$/);
  if (tailModelEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailModelEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    const model = typeof body.model === "string" ? body.model : "";
    const spec = `${job.project}/${job.specFolder}`;
    const result = ctx.queue.editTailModel(id!, step, model);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(body, { error: result.error, spec });
    }
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
  }

  // `/archive` was a route of its own from spec 163 until spec 221 —
  // every archived spec in one sortable, searchable table. It is gone,
  // and there is deliberately no redirect standing in its place: the
  // Specs list is one chip away from the same reading, but it is not
  // the same page, and answering a bookmark with a view that differs
  // from the one it asked for is worse than saying the page is gone.
  // Everything it could do — the date, the description, the "not
  // landed" mark, the search — is on the list it folded into.

  const resetPage = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/reset$/);
  if (resetPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = resetPage;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref || ref.archived) return new Response("not found", { status: 404 });
    return new Response(
      renderResetSpecPage(project!, specFolder!, ctx.nav(), new Date().toISOString(), {
        token: ctx.queueToken,
        error: url.searchParams.get("error") ?? undefined,
        script: queueClientScript(),
      }),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const resetPost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/reset$/);
  if (resetPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = resetPost;
    const back = `${specPagePath(project!, specFolder!)}/reset`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const refuseReset = (error: string): Response =>
      wantsJson ? json({ error }, 400) : specsRedirect({}, { error }, back);
    if (body.confirm !== specFolder) return refuseReset(`type ${specFolder} exactly to confirm Reset`);
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    if (ref.archived) return refuseReset(`${specFolder} is archived — Reset is only for active specs`);
    if (ctx.queue.list().some((job) => job.landing)) return refuseReset("a landing is in progress");
    if (ctx.queue.list().some((job) =>
      job.project === project && job.specFolder === specFolder &&
      (job.state === "queued" || job.state === "running")
    )) return refuseReset("another job for this spec is still running");
    const result = ctx.queue.enqueue({ project, specFolder, steps: ["reset"] });
    if (!result.ok) return refuseReset(result.error);
    await ctx.tickRunner();
    return wantsJson
      ? json({ ok: true, job: result.job })
      : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
  }

  // The SPEC page, and the Update button that keeps it honest (spec
  // 150). Two path segments where the job route has one, so the two
  // are disjoint by shape: a job id never contains a slash, and a
  // spec that has never run has no job id to be found by.
  const specPage = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (specPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = specPage;
    const view = await ctx.specPageView(
      project!,
      specFolder!,
      url.searchParams.get("tab") ?? undefined,
    );
    if (!view) return new Response("not found", { status: 404 });
    const html = renderSpecPage(
      {
        ...view,
        error: url.searchParams.get("error") ?? undefined,
        notice: url.searchParams.get("notice")
          ? { note: url.searchParams.get("notice")!, ok: url.searchParams.get("noticeOk") === "1" }
          : undefined,
        backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/"),
      },
      new Date().toISOString(),
      ctx.nav(),
      {
        tab: url.searchParams.get("tab") ?? undefined,
        step: url.searchParams.get("step") ?? undefined,
      },
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // Pull the specs repository and come back to the same page. Four
  // segments, where the job actions have two and the project ones
  // three — nothing above can match it and it can match nothing
  // above.
  const update = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/update$/);
  if (update) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = update;
    const found = ctx.specDir(project!, specFolder!);
    if (!found) return new Response("not found", { status: 404 });
    const dir = await ctx.machinerySpecDir(project!, found);
    const back = specPagePath(project!, specFolder!);
    // The same lock a merge takes, and for the same hazard: every
    // spec shares the specs root, so two presses — or a press racing
    // the `aide-pull-specs` cron — would be two git sequences in one
    // working tree.
    const result = await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
      pullFastForward(ctx.gitRun, dir, (root) => ctx.branchStatus.defaultBranch(root)),
    );
    if (!result.ok) {
      logRefusal("update", `${project}/${specFolder}`, result.note);
      return specsRedirect({}, { error: result.note }, back);
    }
    return specsRedirect({}, undefined, back, { note: result.note, ok: true });
  }

  const save = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/save$/);
  if (save) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = save;
    const found = ctx.specDir(project!, specFolder!);
    if (!found) return new Response("not found", { status: 404 });
    const dir = await ctx.machinerySpecDir(project!, found);
    // Before the body is even read: this one WRITES, commits and
    // pushes, and an archived spec's folder is in `archive/`.
    if (ctx.specRef(project!, specFolder!)?.archived) {
      logRefusal("save", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
      return specsRedirect({}, { error: ARCHIVED_REFUSAL }, specPagePath(project!, specFolder!));
    }
    const sent = await readBounded(req, MAX_SAVE_BODY);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // The Description tab, which is where the textarea is (spec 212).
    // A refusal has to land where the form was, holding what is
    // actually on disk.
    const back = specTabPath(project!, specFolder!, "description");
    // An EMPTY textarea is a legitimate save — the terminal-edit path
    // this matches has never stopped anyone deleting the lot. A body
    // with no field at all is not: it is a request that never came
    // from this form, and writing it would empty the file.
    if (typeof body.text !== "string") {
      return specsRedirect({}, { error: "no text was submitted — nothing was saved" }, back);
    }
    // Spec 166: the "Depends on" field, resolved the way the runtime
    // gate will later resolve it (`resolveDependencyFolder`, which
    // takes a bare number or a full folder and sees archived specs
    // too) — so a dependency the page accepts is one the gate can
    // read. Refused entry by entry, never filtered: a typo left to
    // drop out silently is a dead gate nobody is told about.
    //
    // `bodyToObject` wraps a lone `dependsOn` value in an array for
    // the New-spec form's chip set, so this field's one comma-
    // separated string arrives as `["164, 165"]`. Both shapes are
    // taken apart the same way rather than un-wrapping one of them.
    const ids = (Array.isArray(body.dependsOn) ? body.dependsOn : [body.dependsOn])
      .filter((v): v is string => typeof v === "string")
      .flatMap((v) => v.split(","))
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length > 0) {
      // `specDir` above already 404s a project that does not resolve,
      // so this cannot actually be undefined — defence in depth, not
      // a path a request can reach.
      const discovered = ctx.opts.projectRoot
        ? discoverProjects(ctx.opts.projectRoot).find((p) => p.name === project)
        : undefined;
      if (!discovered) return specsRedirect({}, { error: "unknown project — nothing was saved" }, back);
      for (const id of ids) {
        const dep = resolveDependencyFolder(discovered, id);
        if (!dep) {
          return specsRedirect({}, { error: `no such spec in this project: ${id} — nothing was saved` }, back);
        }
        if (dep.folder === specFolder) {
          return specsRedirect({}, { error: `a spec cannot depend on itself: ${id} — nothing was saved` }, back);
        }
      }
    }
    const merged = withDependsOnLine(body.text, ids);
    if (merged === null) {
      return specsRedirect(
        {},
        { error: `nowhere to put "Depends on" — Tracking info has no Created line — nothing was saved` },
        back,
      );
    }
    const baseSha = typeof body.baseSha === "string" && body.baseSha ? body.baseSha : null;
    const result = await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
      saveSpecFiles(
        ctx.gitRun,
        dir,
        (root) => ctx.branchStatus.defaultBranch(root),
        [{ file: EDITABLE_SPEC_FILE, text: merged, baseSha }],
        { specLabel: specFolder!, message: editMessage(specFolder!) },
      ),
    );
    if (!result.ok) {
      logRefusal("save", `${project}/${specFolder}`, result.note);
      return specsRedirect({}, { error: result.note }, back);
    }
    // Back to the tab the form is on, where the description now
    // carries its new commit stamp. Not the Overview tab it used to
    // land on: since spec 212 the editor IS a tab of this page, and a
    // reader who has just saved is as likely to keep editing.
    return specsRedirect({}, undefined, back, { note: result.note, ok: true });
  }

  // Spec 212: the checks, on their own route and therefore in their
  // own commit. `/save` above wrote `1-description.md` and, until this
  // route existed, `4-status.md` in the SAME commit — which meant a
  // person had to open the description's editor in order to tick a
  // box. Two forms now, each committing what it owns.
  //
  // `4-status.md` has been the runner's since spec 154 and this is the
  // narrow exception a person is allowed: one existing row's Status
  // mark and nothing else. The new text is computed HERE, from the
  // rows the server itself verified against the file on disk, and
  // never taken from the body — which is what makes "only checkbox
  // lines can change" structural rather than a promise. A `text`
  // field posted at this route is read by nothing.
  const tick = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/tick$/);
  if (tick) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = tick;
    const found = ctx.specDir(project!, specFolder!);
    if (!found) return new Response("not found", { status: 404 });
    const dir = await ctx.machinerySpecDir(project!, found);
    // Before the body is even read: this one WRITES, commits and
    // pushes, and an archived spec's folder is in `archive/`. Hiding
    // the boxes leaves this route reachable for anyone who already
    // has the URL, so the refusal is here and not only on the page.
    if (ctx.specRef(project!, specFolder!)?.archived) {
      logRefusal("tick", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
      return specsRedirect({}, { error: ARCHIVED_REFUSAL }, specPagePath(project!, specFolder!));
    }
    const activeJob = ctx.queue.list().some(
      (job) => job.project === project && job.specFolder === specFolder &&
        (job.state === "queued" || job.state === "running"),
    );
    if (activeJob) {
      const reason = "another job for this spec is still running — nothing was saved";
      logRefusal("tick", `${project}/${specFolder}`, reason);
      return specsRedirect({}, { error: reason }, specPagePath(project!, specFolder!));
    }
    const sent = await readBounded(req, MAX_SAVE_BODY);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // The Overview tab, which is where the boxes are.
    const back = specPagePath(project!, specFolder!);
    // `bodyToObject` wraps a lone value in an array for the New-spec
    // form's chip set, exactly as it does for `dependsOn`, so both
    // shapes are taken apart the same way.
    const ticks = (Array.isArray(body.tick) ? body.tick : [body.tick]).filter((v): v is string => typeof v === "string");
    // Save pressed with every box clear. Nothing to say and nothing to
    // commit — not a refusal either.
    if (ticks.length === 0) return specsRedirect({}, undefined, back);
    // Boxes with no phase to read them against is a request that
    // never came from this form.
    if (typeof body.checksPhase !== "string") {
      return specsRedirect({}, { error: "no phase was submitted — nothing was saved" }, back);
    }
    // The row-level guard, on top of the file-level `baseSha` one
    // below. A `null` is every way the page can be out of date at
    // once: no such phase, no such row inside it, or a row someone
    // has already ticked in the very commit the page was drawn from
    // — which a sha alone cannot tell from a fresh render.
    //
    // Chained one row after another, which is safe because exactly
    // one character moves per tick and the cell keeps its padding:
    // a tick never reflows the table, so every other row's text is
    // still what it was.
    let ticked = specFileText(dir, STATUS_SPEC_FILE) ?? "";
    for (const line of ticks) {
      const next = tickStatusLine(ticked, body.checksPhase, line);
      // One row that is not there refuses the WHOLE press, the boxes
      // beside it included — never applied silently while one of them
      // is dropped.
      if (next === null) {
        return specsRedirect(
          {},
          { error: "that check is not there to tick any more — reload the page and look again" },
          back,
        );
      }
      ticked = next;
    }
    // Spec 190: the hold-back note goes with the last check it was
    // waiting on. A declined archive run writes `## Archive held
    // back` naming one open row and where to close it out; ticking
    // that row IS closing it out, so leaving the section behind
    // makes the page go on reporting a spec held back after the
    // reason is gone.
    //
    // The whole file's checks, not the ticked phase's — a spec with
    // open work in another phase is still held back.
    if (!parseStatusChecks(ticked).some((check) => !check.done)) {
      const cleared = clearArchiveHeldBack(ticked);
      if (cleared !== null) ticked = cleared;
    }
    const statusBaseSha = typeof body.statusBaseSha === "string" && body.statusBaseSha ? body.statusBaseSha : null;
    const result = await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
      saveSpecFiles(
        ctx.gitRun,
        dir,
        (root) => ctx.branchStatus.defaultBranch(root),
        [{ file: STATUS_SPEC_FILE, text: ticked, baseSha: statusBaseSha }],
        { specLabel: specFolder!, message: tickMessage(specFolder!) },
      ),
    );
    if (!result.ok) {
      logRefusal("tick", `${project}/${specFolder}`, result.note);
      return specsRedirect({}, { error: result.note }, back);
    }
    return specsRedirect({}, undefined, back, { note: result.note, ok: true });
  }

  // One job, in full: what it IS (the spec's title and description),
  // every step it has already run, and — while a step is running —
  // what that session is doing. Deliberately AFTER the approve/cancel
  // match above, so the new route cannot swallow those.
  // `/specs/<id>` for the page, `/api/queue/<id>` for its JSON twin:
  // the page was renamed, the API contract was not. The first group
  // therefore says WHICH of the two answered, rather than merely
  // whether an `api/` prefix was there.
  const detail = path.match(/^\/(api\/queue|specs)\/([A-Za-z0-9-]+)$/);
  if (detail) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, surface, id] = detail;
    const api = surface !== "specs";
    const job = ctx.queue.get(id!);
    if (!job) {
      return api ? json({ error: "no such job" }, 404) : new Response("not found", { status: 404 });
    }
    if (api) return json({ generatedAt: new Date().toISOString(), job });
    const html = renderJobDetailPage(
      { ...(await ctx.jobDetailView(job)), backHref: resolveBackHref(req.headers.get("referer"), url.origin, "/") },
      new Date().toISOString(),
      ctx.nav(),
      {
        tab: url.searchParams.get("tab") ?? undefined,
        step: url.searchParams.get("step") ?? undefined,
      },
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return new Response("not found", { status: 404 });
}
