// The queue-creation and project-admin API routes: create, the
// queue's model defaults, and add/settings/deploy/remove
// for a project. Extracted from routes.ts (split of split
// serve.ts step 2).
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { renderSentence } from "../../i18n/message.ts";
import { fastForwardToOrigin } from "../../git/branch-merge.ts";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT } from "../../git/dashboard-checkout.ts";
import { MAIN_TEST_SERVER_KEY, restartMainTestServer, stopTestServer } from "../test-servers/lifecycle.ts";
import { testServerFailedPage } from "./spec-edit/test-server-waiting.ts";
import { runningJobNames } from "../land-branch";
import { resolveInstallCmd } from "../../project/discover";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import { listedModelName } from "../../queue/model-name.ts";
import { persistQueueSettings } from "../../queue/queue.ts";
import { addProject, addProjectTarget, assessProjectReadiness, commitManifestEdits, projectNameError, removeProject, updateProjectSettings } from "../../project/project-admin";
import { NEW_SPEC_ROUTE, SETTINGS_ROUTE, SETTINGS_ROWS } from "../../render";
import { bodyToObject, json, logRefusal, readBounded, specsRedirect } from "../serve-helpers";
import { CHECKABLE_TOOLS, checkTool, isCheckableTool, recordCheck } from "../tool-check.ts";
import type { RoutesContext } from "./";

export async function handleQueueAdminRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
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

  // Asking one tool whether it is usable on this host. A GET never runs
  // it: the check spawns a CLI and reaches the network, so it happens
  // when the button is pressed and at no other time.
  if (path === "/api/queue/settings/check") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try { raw = bodyToObject(body.text, req.headers.get("content-type")); }
    catch { return json({ error: "malformed body" }, 400); }
    const tool = (raw as Record<string, unknown> | null)?.tool;
    if (!isCheckableTool(tool)) {
      const error = `unknown tool: the checkable ones are ${CHECKABLE_TOOLS.join(", ")}`;
      return wantsJson
        ? json({ error }, 400)
        : new Response(null, {
            status: 303,
            headers: { location: `${SETTINGS_ROUTE}?error=${encodeURIComponent(error)}` },
          });
    }
    // Only this tool's own models: asking OpenCode whether a Claude
    // model is in its list would report every one of them missing.
    const configuredModels = Object.values(ctx.queue.defaults.modelChoices ?? {})
      .filter((choice) => (choice.tool ?? "claude") === tool)
      .map((choice) => choice.model)
      .filter((model): model is string => typeof model === "string" && model.length > 0);
    const check = await checkTool(tool, { configuredModels });
    recordCheck(check);
    return wantsJson
      ? json({ ok: true, check })
      : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?tab=${tool}` } });
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
    const refuse = (error: string) => wantsJson
      ? json({ error }, 400)
      : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?error=${encodeURIComponent(error)}` } });
    if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
    if (!models || typeof models !== "object" || Array.isArray(models)) return refuse("model defaults are missing");
    const table = models as Record<string, unknown>;
    const unknown = Object.keys(table).find((step) => !(SETTINGS_ROWS as readonly string[]).includes(step));
    if (unknown) return refuse(`unknown workflow step: ${unknown}`);
    const next: Record<string, string> = {};
    for (const step of SETTINGS_ROWS) {
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
    for (const step of SETTINGS_ROWS) {
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
    return wantsJson
      ? json({ ok: true, model: next, timeoutSec })
      : new Response(null, { status: 303, headers: { location: `${SETTINGS_ROUTE}?notice=${encodeURIComponent("Defaults saved")}` } });
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
      codeLanding: text(asked.codeLanding),
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
    // The manifest keys are committed and pushed in the checkout the
    // settings are read from and written to, the moment they are saved —
    // never left on disk for the next pull there to refuse over. On a
    // serving host that entry is a link to the dashboard's own checkout
    // (projects.md), so the lock is taken on the directory it resolves
    // to: the same key a landing into that checkout takes.
    const settingsDir = join(ctx.opts.projectRoot, name);
    const codeRoot = realpathOr(settingsDir);
    const saveManifest = (edits: { key: string; value: string }[]) =>
      ctx.mergeLock.run(codeRoot, () =>
        commitManifestEdits(
          { run: ctx.gitRun, resolveBase: (root: string) => ctx.branchStatus.defaultBranch(root) },
          codeRoot,
          edits,
        ),
      );
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
    }, { saveManifest });
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
            headers: {
              location: `/projects/${encodeURIComponent(name)}?deployError=${encodeURIComponent(error)}&tab=deploy`,
            },
          });
    };
    if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
      return refuse(`"${name}" is not a project this dashboard knows`);
    }
    const root = ctx.machineryProjectDir(name);
    if (!resolveInstallCmd(root).value) {
      return refuse(`${name} has no ${SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase()} configured — deploying stays a hand step`);
    }
    const base = await ctx.branchStatus.defaultBranch(root);
    if (!base) return refuse(`cannot work out the default branch in ${root}`);
    const result = await ctx.mergeLock.run(root, () => fastForwardToOrigin(ctx.gitRun, root, base));
    if (!result.ok) return refuse(renderSentence("en", result.error) ?? `cannot bring ${root} up to date`);
    const after = await ctx.installAfterMerge(result);
    // Fresh, not cached: the checkout just moved, and the next reader
    // of this project's page must not see the old count for up to
    // driftPollMs longer.
    await ctx.branchStatus.commitsBehindOrigin(root, true);
    // The answer is composed first and the restart fired after it: a
    // restart awaited in here landed before the answer went out, and
    // the page read "the request failed" for a deploy that had
    // succeeded (2026-09-03). `restarting` tells the page to wait for
    // the service to come back before it reloads; `restartWaiting`
    // (spec 385) names the jobs holding that restart back instead, when
    // there are any — the two never both appear.
    const restartWaiting = after.restart ? runningJobNames(ctx.queue) : [];
    if (restartWaiting.length > 0) ctx.setPendingRestart(restartWaiting);
    const restarting = !!after.restart && restartWaiting.length === 0;
    let response: Response;
    if (result.installError) {
      const installErrorText = renderSentence("en", result.installError)!;
      console.error(`queue: deploy ${name} in ${root} — ${installErrorText}`);
      response = wantsJson
        ? json({ ok: true, installError: installErrorText, restarting, ...(restartWaiting.length > 0 && { restartWaiting }) })
        : new Response(null, {
            status: 303,
            headers: {
              location: `/projects/${encodeURIComponent(name)}?deployError=${encodeURIComponent(installErrorText)}&tab=deploy`,
            },
          });
    } else {
      response = wantsJson
        ? json({ ok: true, restarting, ...(restartWaiting.length > 0 && { restartWaiting }) })
        : new Response(null, {
            status: 303,
            headers: { location: `/projects/${encodeURIComponent(name)}?tab=deploy` },
          });
    }
    after.restart?.();
    return response;
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
  // through `specs-client.ts`'s XHR — unlike the start route above — so
  // this one answers `wantsJson` the same way `board-controls.ts`'s own
  // stop route does, rather than always redirecting.
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
    return wantsJson
      ? json({ ok: true })
      : new Response(null, {
          status: 303,
          headers: { location: `/projects/${encodeURIComponent(name)}?tab=deploy` },
        });
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
    const result = removeProject(ctx.allowed, { name });
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

  return null;
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
