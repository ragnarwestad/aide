// The project routes that add a project and save its settings, and the
// commit both make of the manifest keys a save changed.

import { realPathOrOriginal as realpathOr } from "../../../git/real-path.ts";
import { join } from "node:path";
import { DEFAULT_DASHBOARD_CHECKOUT_ROOT, dashboardSettingsFile } from "../../../git/dashboard-checkout/index.ts";
import { addProject, assessProjectReadiness, commitManifestEdits, updateProjectSettings, type SaveManifest } from "../../../project/project-admin";
import type { SettingsRequest } from "../../../project/project-admin/update-settings.ts";
import { readObjectBody } from "../../serve-helpers";
import type { RoutesContext } from "../";

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

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

// What the form set beyond the name and the address is saved the way
  // the Config tab's Save does it, now that the project exists: into
  // `settings.yaml` or `.aide/config`, or committed to a tracked
  // manifest. A field left empty and a default (Merge, `none`) write
  // nothing, so an Add never overwrites a value a team's manifest
  // already sets. For a project that tracks no manifest `addProject`
  // has written the links, a `pr` landing and the description already,
  // and a save writes only what differs from what is stored.

function settingsAfterAdd(asked: Record<string, unknown>): SettingsRequest {
  const previewFrom = text(asked.previewFrom);
    const codeLanding = text(asked.codeLanding);
    return {
      ...(previewFrom && previewFrom !== "none" && { previewFrom }),
      ...(codeLanding === "pr" && { codeLanding }),
      ...(text(asked.worktreeLinks) && { worktreeLinks: text(asked.worktreeLinks) }),
      ...(text(asked.description) && { description: text(asked.description) }),
      ...(text(asked.testCmd) && { testCmd: text(asked.testCmd) }),
      ...(text(asked.installCmd) && { installCmd: text(asked.installCmd) }),
      ...(text(asked.previewCmd) && { previewCmd: text(asked.previewCmd) }),
      ...(text(asked.worktreeSetup) && { worktreeSetup: text(asked.worktreeSetup) }),
      ...(text(asked.acPrefix) && { acPrefix: text(asked.acPrefix) }),
      ...(text(asked.icon) && { icon: text(asked.icon) }),
    };
  }

/** What an add does once the project is there: the rest of the form saved,
 *  the dashboard's own checkout made, and the readiness taken again. */
async function afterAdd(
  ctx: RoutesContext, name: string, asked: Record<string, unknown>, steps: { step: string; ok: boolean }[],
  readiness: Awaited<ReturnType<typeof assessProjectReadiness>> | undefined,
) {
  const projectRoot = ctx.opts.projectRoot!;
  ctx.allowed.add(name);
  // The five-second scan is what every other list on this page
  // reads; without this the very request after an Add would still
  // not see the project.
  ctx.invalidateScan();
  steps.push(ctx.persistAllowlist("added to the allowlist"));
  const later = settingsAfterAdd(asked);
  if (Object.keys(later).length) {
    const saved = await updateProjectSettings(ctx.gitRun, join(projectRoot, name), later, {
      saveManifest: manifestSaver(ctx, name),
      settingsFile: dashboardSettingsFile(ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT, name),
    });
    steps.push(...saved.steps);
  }
  // Eagerly, and here rather than inside `addProject` —
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
    return assessProjectReadiness(
      ctx.gitRun,
      join(projectRoot, name),
      ctx.machineryProjectDir(name),
    ).catch(() => readiness ?? undefined);
}

export async function addProjectRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  if (path !== "/api/queue/projects") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const asked = sent.body;
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
  const readiness = result.ok ? await afterAdd(ctx, name, asked, steps, result.readiness) : result.readiness;
  // Only for an add that got as far as writing its files: there is
  // nothing to assess in a clone that never happened, and a
  // readiness answer about a project that was not added would be an
  // answer about somebody else's directory.
  return ctx.answerProjectChange("add-project", name, steps, readiness);
}

/** The settings a save posted, each only when the form sent it: a caller
 *  posting only the older fields must not be read as clearing the ones it
 *  never mentioned. */
function postedSettings(asked: Record<string, unknown>): SettingsRequest {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    ...("specsPath" in asked && { specsPath: str(asked.specsPath) }),
    ...("worktreeLinks" in asked && { worktreeLinks: str(asked.worktreeLinks) }),
    ...("codeLanding" in asked && { codeLanding: str(asked.codeLanding) }),
    ...("installCmd" in asked && { installCmd: str(asked.installCmd) }),
    ...("previewCmd" in asked && { previewCmd: str(asked.previewCmd) }),
    ...("worktreeSetup" in asked && { worktreeSetup: str(asked.worktreeSetup) }),
    ...("testCmd" in asked && { testCmd: str(asked.testCmd) }),
    ...("acPrefix" in asked && { acPrefix: str(asked.acPrefix) }),
    ...("description" in asked && { description: str(asked.description) }),
    ...("icon" in asked && { icon: str(asked.icon) }),
    ...("previewFrom" in asked && { previewFrom: str(asked.previewFrom) }),
  };
}

export async function projectSettingsRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const settingsPost = path.match(/^\/api\/queue\/projects\/([^/]+)\/settings$/);
  if (!settingsPost) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const name = decodeURIComponent(settingsPost[1]!);
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) {
    return ctx.answerProjectChange(
      "project-settings",
      name,
      [{ step: "name", ok: false, error: `"${name}" is not a project this dashboard knows` }],
    );
  }
  const asked = sent.body;
  // The manifest keys are committed and pushed in the checkout the
  // settings are read from and written to, the moment they are saved —
  // never left on disk for the next pull there to refuse over. On a
  // serving host that entry is a link to the dashboard's own checkout
  // (projects.md), so the lock is taken on the directory it resolves
  // to: the same key a landing into that checkout takes.
  const checkoutBase = ctx.opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;
  const settingsDir = join(ctx.opts.projectRoot, name);
  const result = await updateProjectSettings(ctx.gitRun, settingsDir, postedSettings(asked), { saveManifest: manifestSaver(ctx, name), settingsFile: dashboardSettingsFile(checkoutBase, name) });
  // The specs root a save just named is where the scan goes looking
  // for this project's specs — without this the very next request
  // would still read the old one.
  if (result.ok) ctx.invalidateScan();
  // And it is what `aide-run-spec` reads out of the DASHBOARD's own
  // checkout: the write above reached the person's
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
