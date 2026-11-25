// The queue-creation and project-admin API routes: create, the
// queue's model defaults, and add/settings/remove
// for a project. Extracted from routes.ts (split of split
// serve.ts step 2).
import { MAIN_TEST_SERVER_KEY, restartMainTestServer, stopTestServer } from "../test-servers/lifecycle.ts";
import { testServerFailedPage } from "./spec-edit/test-server-waiting.ts";
import { CLEANUP_KEY, jobKind, inFlight } from "../../queue/queue.ts";
import { cleanupProject } from "../process-cleanup/schedule.ts";
import { hiddenProjects } from "./page-routes/project-hide.ts";
import { detectRemoteTestCommand, projectNameError, removeProject } from "../../project/project-admin";
import { MAX_CREATE_BODY, bodyToObject, json, readBounded, readObjectBody, refusal } from "../serve-helpers";
import type { RoutesContext } from "./";
import { saveQueueSettings } from "./settings-save/index.ts";
import { enqueueRequest } from "../../queue/request/index.ts";
import { parseCreateRequest } from "../../queue/parse-request.ts";
import { createSpecDirectly } from "./direct-create/index.ts";
import { queueDefaultsRoute } from "./settings-save/defaults-route.ts";
import { addProjectRoute, projectSettingsRoute } from "./project-admin/index.ts";

async function cleanupRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  if (path === "/api/queue/cleanup") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const existing = ctx.queue.list().find((job) => jobKind(job) === "cleanup" && inFlight(job));
    if (existing) return json({ ok: true, job: existing });
    const project = cleanupProject(ctx.allowed, hiddenProjects(ctx));
    if (!project) return json({ ok: false, error: "this board has no project for the cleanup job" }, 400);
    const result = enqueueRequest(ctx.queue, { project, specFolder: CLEANUP_KEY, steps: ["cleanup"] }, "manual");
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
  }
  return null;
}

async function createRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  if (path === "/api/queue/create") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const sent = await readObjectBody(req, { cap: MAX_CREATE_BODY });
    if ("refusal" in sent) return sent.refusal;
    const result = parseCreateRequest(sent.body, {
      allow: (project) => ctx.allowed.has(project),
      resolve: (project) => ({
        specFolders: ctx.targets().filter((target) => target.project === project).map((target) => target.specFolder),
        archivedFolders: (ctx.readScan()?.archived ?? [])
          .filter((key) => key.startsWith(`${project}/`))
          .map((key) => key.slice(project.length + 1)),
      }),
      defaults: ctx.queue.defaults,
    });
    if (!result.ok) return refusal(result);
    const created = await createSpecDirectly(ctx, result.create!);
    if (!created.ok) return json(created, 400);
    if (created.specDir) await ctx.rereadSpec?.(created.specDir, created.specFolder).catch(() => {});
    ctx.invalidateScan();
    ctx.notifyQueueChanged();
    return json({ ok: true, specFolder: created.specFolder });
  }
  return null;
}

async function projectsTestCommandRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  // What test command the root files of a git address point at, for the
  // Add form's placeholder. Matched by its exact path ahead of the
  // per-project routes: no project of that name exists yet. A POST, so the
  // request guard's same-origin check applies — a GET could be fired by
  // another site's page and make this server clone an address of its choosing.
  if (path === "/api/queue/projects/test-command") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const gitUrl = sent.body.gitUrl;
    return json({ ok: true, testCmd: typeof gitUrl === "string" ? await detectRemoteTestCommand(ctx.gitRun, gitUrl) : null });
  }
  return null;
}

async function projectsTestServerRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  // The Deploy tab's "Testserver med testspecene" button.
  // Its form deliberately carries none of `deployform`/`actionform`/
  // `rowrun` (see `project-page.ts`'s `testServerSection`), so this is
  // always a plain browser POST followed by a real navigation — never an
  // XHR — which is what lets it open in a new tab and land the reader on
  // the same waiting page the spec-page's own test-server link uses.
  const testServerPost = path.match(/^\/api\/queue\/projects\/([^/]+)\/test-server$/);
  if (testServerPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(testServerPost[1]!);
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return new Response("no such project\n", { status: 404 });
    }
    if (!ctx.testServers.previewAvailable(name)) {
      return testServerFailedPage(name, MAIN_TEST_SERVER_KEY, "this project's own checkout does not carry the dashboard's source");
    }
    const root = ctx.testServers.aideCheckout(name);
    const branch = await ctx.branchStatus.defaultBranch(root);
    if (!branch) return testServerFailedPage(name, MAIN_TEST_SERVER_KEY, `cannot work out the default branch in ${root}`);
    const result = await restartMainTestServer(ctx.testServers, name, branch);
    if (!result.ok) return testServerFailedPage(name, MAIN_TEST_SERVER_KEY, result.error);
    return new Response(null, {
      status: 303,
      headers: { location: `/projects/${encodeURIComponent(name)}?startTestServer=1` },
    });
  }
  return null;
}

async function testServerStopRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  // The Test servers list's own Stop button for a board tracked
  // under `MAIN_TEST_SERVER_KEY` — it has no real spec to be scoped to, so it
  // cannot reach `board-controls.ts`'s spec-scoped route. That row's form
  // carries `class="actionform"` (test-servers-page.ts), which IS posted
  // through `specs-client.ts`'s XHR — unlike the start route above.
  const testServerStop = path.match(/^\/api\/queue\/projects\/([^/]+)\/test-server\/stop$/);
  if (testServerStop) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(testServerStop[1]!);
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return new Response("no such project\n", { status: 404 });
    }
    stopTestServer(ctx.testServers, name, MAIN_TEST_SERVER_KEY, "the Stop button on the Deploy tab");
    return json({ ok: true });
  }
  return null;
}

async function projectsFetchSpecsRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  // A session on another machine pushed specs and says so: ask origin again now instead of at the next sweep.
  // It takes nothing, so an unknown project is refused before anything is read.
  const fetchSpecs = path.match(/^\/api\/queue\/projects\/([^/]+)\/fetch-specs$/);
  if (fetchSpecs) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(fetchSpecs[1]!);
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return new Response("no such project\n", { status: 404 });
    // `fresh`, as a queued job asks: a fetch already running took its picture of origin before this push.
    if (!(await ctx.ensureCheckout(name, { fresh: true }))) {
      return json({ ok: false, error: `the dashboard has no checkout of its own for ${name}, so there was nothing to fetch` }, 400);
    }
    ctx.invalidateScan();
    await ctx.rereadProject(name).catch(() => {});
    return json({ ok: true });
  }
  return null;
}

async function projectsRemoveRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  const removal = path.match(/^\/api\/queue\/projects\/([^/]+)\/remove$/);
  if (removal) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const name = decodeURIComponent(removal[1]!);
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    try {
      bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const nameError = projectNameError(name);
    if (nameError) {
      return ctx.answerProjectChange("remove-project", name, [{ step: "name", ok: false, error: nameError }]);
    }
    const result = removeProject(ctx.allowed, { name });
    const steps = [...result.steps];
    if (result.ok) {
      ctx.invalidateScan();
      // A project added again later under the same name starts without the old one's model choices.
      if (ctx.queue.defaults.projectModels?.[name]) saveQueueSettings(ctx, { projectModels: { [name]: null } });
      // `removeProject` already reported the allowlist step; this
      // replaces it with the same step told from the other side of the
      // write, rather than reporting the one thing twice.
      steps[steps.length - 1] = ctx.persistAllowlist("removed from the allowlist");
    }
    return ctx.answerProjectChange("remove-project", name, steps);
  }
  return null;
}

export async function handleQueueAdminRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  return (
    (await cleanupRoute(ctx, req, path)) ??
    (await createRoute(ctx, req, path)) ??
    (await queueDefaultsRoute(ctx, req, path)) ??
    (await addProjectRoute(ctx, req, path)) ??
    (await projectsTestCommandRoute(ctx, req, path)) ??
    (await projectSettingsRoute(ctx, req, path)) ??
    (await projectsTestServerRoute(ctx, req, path)) ??
    (await testServerStopRoute(ctx, req, path)) ??
    (await projectsFetchSpecsRoute(ctx, req, path)) ??
    (await projectsRemoveRoute(ctx, req, path)) ??
    null
  );
}

