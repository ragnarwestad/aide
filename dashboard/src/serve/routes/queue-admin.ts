// The queue-creation and project-admin API routes: create, the
// queue's model defaults, and add/settings/remove
// for a project. Extracted from routes.ts (split of split
// serve.ts step 2).
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT, dashboardSettingsFile } from "../../git/dashboard-checkout.ts";
import { MAIN_TEST_SERVER_KEY, restartMainTestServer, stopTestServer } from "../test-servers/lifecycle.ts";
import { testServerFailedPage } from "./spec-edit/test-server-waiting.ts";
import { listedModelName } from "../../queue/model-name.ts";
import { persistQueueSettings } from "../../queue/queue.ts";
import { wikiTrackingKey } from "../../queue/steps.ts";
import { addProject, assessProjectReadiness, commitManifestEdits, projectNameError, removeProject, updateProjectSettings, type SaveManifest } from "../../project/project-admin";
import { isToolPart, SETTINGS_STEPS, TOOL_PARTS } from "../../render";
import { MAX_CREATE_BODY, bodyToObject, json, logRefusal, readBounded } from "../serve-helpers";
import { CHECKABLE_TOOLS, checkTool, isCheckableTool, recordCheck } from "../tool-check.ts";
import { readUsage, recordUsage } from "../tool-usage";
import { readModels, recordModels } from "../tool-models";
import { recordClaudeVersions } from "./settings-models.ts";
import type { RoutesContext } from "./";

export async function handleQueueAdminRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === "/api/queue/create") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req, MAX_CREATE_BODY);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const result = ctx.queue.enqueueCreate(raw);
    if (!result.ok) return json({ error: result.error }, 400);
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
  }

  // Asking one tool one of three things, as the tab whose Check was
  // pressed shows it: whether it is usable on this host (Installation),
  // how much of its subscription is used (Usage), or which models
  // it offers (Models). A press reads that one and leaves the other two
  // readings as they were. A GET never runs any of them: each spawns a CLI
  // and reaches the network, so they happen when a button is pressed and
  // at no other time. The usage and the models are read here and nowhere
  // else.
  if (path === "/api/queue/settings/check") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try { raw = bodyToObject(body.text, req.headers.get("content-type")); }
    catch { return json({ error: "malformed body" }, 400); }
    const tool = (raw as Record<string, unknown> | null)?.tool;
    if (!isCheckableTool(tool)) {
      return json({ error: `unknown tool: the checkable ones are ${CHECKABLE_TOOLS.join(", ")}` }, 400);
    }
    const part = (raw as Record<string, unknown> | null)?.part;
    if (!isToolPart(part)) {
      return json({ error: `unknown tab: a Check reads one of ${TOOL_PARTS.join(", ")} — reload the page and press it again` }, 400);
    }
    const probe = ctx.opts.toolProbe;
    if (part === "installation") {
      // Only this tool's own models: asking OpenCode whether a Claude
      // model is in its list would report every one of them missing.
      const configuredModels = Object.values(ctx.queue.defaults.modelChoices ?? {})
        .filter((choice) => (choice.tool ?? "claude") === tool)
        .map((choice) => choice.model)
        .filter((model): model is string => typeof model === "string" && model.length > 0);
      const check = probe ? await probe.check(tool, { configuredModels }) : await checkTool(tool, { configuredModels });
      recordCheck(check);
      return json({ ok: true, check });
    }
    if (part === "subscription") {
      const usage = probe ? await probe.usage(tool) : await readUsage(tool);
      recordUsage(usage);
      return json({ ok: true, usage });
    }
    // Every model value of this tool's choices, its key where it names
    // none: what the models read are set against.
    const configured = Object.entries(ctx.queue.defaults.modelChoices ?? {})
      .filter(([, choice]) => (choice.tool ?? "claude") === tool)
      .map(([name, choice]) => choice.model ?? name);
    const models = probe ? await probe.models(tool, { configured }) : await readModels(tool, { configured });
    recordModels(models);
    recordClaudeVersions(ctx.queue, models, ctx.opts.modelIdsPath);
    return json({ ok: true, models });
  }

  // Matched by string equality, so it and the check route above cannot
  // shadow each other whatever the order.
  if (path === "/api/queue/settings") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try { raw = bodyToObject(body.text, req.headers.get("content-type")); }
    catch { return json({ error: "malformed body" }, 400); }
    const asked = raw as Record<string, unknown> | null;
    const models = asked?.model;
    const refuse = (error: string) => json({ error }, 400);
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
      const listed = listedModelName(Object.keys(ctx.queue.defaults.modelChoices ?? {}), value);
      if ("candidates" in listed) {
        const hint = listed.candidates.length ? ` (listed as ${listed.candidates.join(" or ")})` : "";
        return refuse(`unknown or not-allowed model for ${step}: ${value}${hint}`);
      }
      next[step] = listed.name;
    }

    // timeoutSec: the ceiling a per-job request can only tighten
    // (`tighten()` above), never loosen — this range catches an
    // operator's typo.
    const numField = (v: unknown, name: string, min: number, max: number): number | { error: string } => {
      if (typeof v !== "number" || !Number.isFinite(v)) return { error: `invalid ${name}` };
      if (v < min || v > max) return { error: `${name} must be between ${min} and ${max}` };
      return v;
    };

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
    const error = persistQueueSettings(ctx.opts.queueConfigFile, { model: next, timeoutSec });
    if (error) return refuse(error);
    ctx.queue.defaults.model = merged;
    ctx.queue.defaults.timeoutSec = { ...ctx.queue.defaults.timeoutSec, ...timeoutSec };
    return json({ ok: true, model: next, timeoutSec });
  }

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
    // A project's name is the directory the clone makes, so the name the
    // allowlist gets is the one the form typed, trimmed.
    const name = rawName.trim() || rawName;
    // Adding a project means putting a directory under the projects
    // root, and without `--root` there is no such root: refused in
    // those words rather than half-done somewhere arbitrary.
    if (!ctx.opts.projectRoot) {
      return ctx.answerProjectChange(
        "add-project",
        name,
        [{ step: "name", ok: false, error: "this server was started without --root, so it has no projects root to add to" }],
      );
    }
    const result = await addProject(ctx.gitRun, ctx.opts.projectRoot, {
      name: rawName,
      gitUrl: text(asked.gitUrl),
      description: text(asked.description),
      specsPath: text(asked.specsPath),
      worktreeLinks: text(asked.worktreeLinks),
      codeLanding: text(asked.codeLanding),
      previewFrom: text(asked.previewFrom),
    }, ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT);
    const steps = [...result.steps];
    let readiness = result.readiness;
    if (result.ok) {
      ctx.allowed.add(name);
      // The five-second scan is what every other list on this page
      // reads; without this the very request after an Add would still
      // not see the project.
      ctx.invalidateScan();
      steps.push(ctx.persistAllowlist("added to the allowlist"));
      // A choice other than `none` is saved the way the Config tab's Save
      // does it, now that the project exists: into `settings.yaml`, or
      // committed to a tracked manifest that does not already say it.
      // `none` saves nothing, so an Add never overwrites a value a team's
      // manifest already sets.
      const previewFrom = text(asked.previewFrom);
      if (previewFrom && previewFrom !== "none") {
        const saved = await updateProjectSettings(ctx.gitRun, join(ctx.opts.projectRoot, name), { previewFrom }, {
          saveManifest: manifestSaver(ctx, name),
          settingsFile: dashboardSettingsFile(ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT, name),
        });
        steps.push(...saved.steps);
      }
      // Spec 205: eagerly, and here rather than inside `addProject` —
      // the alternative is every project's first run, Save or Update
      // paying a full clone inside the request that happens to need
      // one, which is a latency regression nobody asked for. The
      // readiness is re-taken afterwards so the answer describes the
      // checkout that now exists, not the one that did not a moment
      // ago.
      // `clone: true`: this press is one of the two moments a clone may
      // be made at all (`EnsureRequest.mayClone`).
      await ctx.ensureCheckout(name, { clone: true });
      // Again, after the ensure: the invalidation above can be refilled
      // by a request that lands while the clone is still being made, and
      // the clone's derived manifest is what lists a project whose own
      // checkout holds none.
      ctx.invalidateScan();
      readiness = await assessProjectReadiness(
        ctx.gitRun,
        join(ctx.opts.projectRoot, name),
        ctx.machineryProjectDir(name),
      ).catch(() => readiness ?? undefined);
      // The project's first wiki build, so its first analysis has a wiki
      // to read: the job Build wiki queues. Queued after the checkout is
      // made, since a tick never clones one; the runner's timer starts
      // it. A refusal is logged and is not a refusal of the add.
      const wiki = ctx.queue.enqueue({ project: name, specFolder: wikiTrackingKey(name), steps: ["wiki"] });
      if (!wiki.ok) logRefusal("build wiki", name, wiki.error);
    }
    // Only for an add that got as far as writing its files: there is
    // nothing to assess in a clone that never happened, and a
    // readiness answer about a project that was not added would be an
    // answer about somebody else's directory.
    return ctx.answerProjectChange("add-project", name, steps, readiness);
  }

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
      );
    }
    const asked = (raw ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    // The manifest keys are committed and pushed in the checkout the
    // settings are read from and written to, the moment they are saved —
    // never left on disk for the next pull there to refuse over. On a
    // serving host that entry is a link to the dashboard's own checkout
    // (projects.md), so the lock is taken on the directory it resolves
    // to: the same key a landing into that checkout takes.
    const checkoutBase = ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;
    const settingsDir = join(ctx.opts.projectRoot, name);
    const result = await updateProjectSettings(ctx.gitRun, settingsDir, {
      ...("specsPath" in asked && { specsPath: str(asked.specsPath) }),
      ...("worktreeLinks" in asked && { worktreeLinks: str(asked.worktreeLinks) }),
      // Only when the form actually sent one (spec 220, then 255 for
      // the one that joined it): a caller posting only the older
      // fields must not be read as clearing the ones it never
      // mentioned.
      ...("codeLanding" in asked && { codeLanding: str(asked.codeLanding) }),
      ...("installCmd" in asked && { installCmd: str(asked.installCmd) }),
      ...("previewCmd" in asked && { previewCmd: str(asked.previewCmd) }),
      ...("testCmd" in asked && { testCmd: str(asked.testCmd) }),
      ...("previewFrom" in asked && { previewFrom: str(asked.previewFrom) }),
    }, { saveManifest: manifestSaver(ctx, name), settingsFile: dashboardSettingsFile(checkoutBase, name) });
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
    // A fresh one, not any answer: a settings file saved a moment ago
    // reaches the clone's derived manifest only in an ensure that
    // started after the save.
    const readiness = result.ok
      ? await ctx.ensureCheckout(name, { fresh: true, clone: true }).then(() =>
          assessProjectReadiness(ctx.gitRun, join(ctx.opts.projectRoot!, name), ctx.machineryProjectDir(name)).catch(
            () => result.readiness,
          ),
        )
      : result.readiness;
    return ctx.answerProjectChange("project-settings", name, result.steps, readiness);
  }

  // AC-3/AC-5/AC-6: the Deploy tab's "Testserver med testspecene" button.
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
      return testServerFailedPage(MAIN_TEST_SERVER_KEY, "this project's own checkout does not carry the dashboard's source");
    }
    const root = ctx.testServers.aideCheckout(name);
    const branch = await ctx.branchStatus.defaultBranch(root);
    if (!branch) return testServerFailedPage(MAIN_TEST_SERVER_KEY, `cannot work out the default branch in ${root}`);
    const result = await restartMainTestServer(ctx.testServers, name, branch);
    if (!result.ok) return testServerFailedPage(MAIN_TEST_SERVER_KEY, result.error);
    return new Response(null, {
      status: 303,
      headers: { location: `/projects/${encodeURIComponent(name)}?startTestServer=1` },
    });
  }

  // AC-7: the Test servers list's own Stop button for a board tracked
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
      // `removeProject` already reported the allowlist step; this
      // replaces it with the same step told from the other side of the
      // write, rather than reporting the one thing twice.
      steps[steps.length - 1] = ctx.persistAllowlist("removed from the allowlist");
    }
    return ctx.answerProjectChange("remove-project", name, steps);
  }

  return null;
}

/** Commits and pushes the manifest keys a save changed, in the checkout
 *  the project's settings are read from and written to, the moment they
 *  are saved — never left on disk for the next pull there to refuse
 *  over. On a serving host that entry is a link to the dashboard's own
 *  checkout (projects.md), so the lock is taken on the directory it
 *  resolves to: the same key a landing into that checkout takes. Both
 *  the settings route and the add route save through it. */
function manifestSaver(ctx: RoutesContext, name: string): SaveManifest {
  const codeRoot = realpathOr(join(ctx.opts.projectRoot!, name));
  return (edits) =>
    ctx.mergeLock.run(codeRoot, () =>
      commitManifestEdits(
        { run: ctx.gitRun, resolveBase: (root: string) => ctx.branchStatus.defaultBranch(root) },
        codeRoot,
        edits,
      ),
    );
}

/** The directory a path resolves to, or the path itself when it cannot
 *  be resolved — the lock key a landing into the same checkout uses. */
function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
