// the spec page itself, its Update, and the Save that writes one of the spec's files. One of the three families `handleSpecEditRoutes` asks in
// turn (split 2026-09-04: the file had reached 567 lines). Every
// check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own.
import { pullFastForward, saveSpecFiles } from "../../../git/specs-pull.ts";
import { resolveOpenBranchTarget, writeStatusToBranch } from "../../../git/branch-file.ts";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { runAideWriteSpec } from "../../../git/run-aide-write-spec.ts";
import { discoverProjects, withDependsOnLine } from "../../../project/discover.ts";
import { EDITABLE_SPEC_FILE, FILE_TABS, STATUS_SPEC_FILE, documentTabScript, renderSpecPage, resolveBackHref, resolveSpecTab, specPagePath, specTabPath } from "../../../render.ts";
import { ARCHIVED_REFUSAL, MAX_SAVE_BODY, SPEC_EDITOR_ASSET_PATH, SPEC_VIEWER_ASSET_PATH, bodyToObject, editMessage, json, logRefusal, readBounded, resolveDependencyFolder, specsRedirect } from "../../serve-helpers.ts";
import { STATE_SPEC_FILE, stateRelPath } from "./shared.ts";

import type { HandleQueueContext } from "../../handle-queue.ts";

export async function specPageRoutes(
  ctx: HandleQueueContext,
  req: Request,
  url: URL,
  path: string,
  _wantsJson: boolean,
): Promise<Response | null> {
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
    // Resolved through the SAME function the render side uses
    // (`spec-page.ts`), rather than each computing its own default —
    // that mismatch was spec 303's actual bug: a bare URL rendered the
    // Description panel while loading no editor script for it.
    const tab = resolveSpecTab(url.searchParams.get("tab") ?? undefined);
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
        tab,
        step: url.searchParams.get("step") ?? undefined,
        // REQ-1/REQ-4/REQ-5 (spec 315, extended by spec 333): a src=
        // reference to whichever bundle's own route this tab's panel
        // actually mounts (`documentTabScript`, the same predicate
        // `panels.ts` uses to decide what to draw) — the editor for a
        // writable tab, the lighter viewer for a locked one with real
        // text, or no script at all.
        scriptSrc:
          documentTabScript(view, tab) === "editor" ? SPEC_EDITOR_ASSET_PATH :
          documentTabScript(view, tab) === "viewer" ? SPEC_VIEWER_ASSET_PATH :
          undefined,
      },
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

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
    // REQ-2: the file comes in with the request now; a request that
    // predates this field (only Description's own form ever posted
    // here) defaults to it, so nothing already posting to `/save`
    // breaks. Anything outside the four editable files is refused
    // before the body is read further.
    const file = typeof body.file === "string" ? body.file : EDITABLE_SPEC_FILE;
    const tab = FILE_TABS[file];
    if (!tab) {
      return specsRedirect(
        {},
        { error: `unknown spec file: ${file} — nothing was saved` },
        specPagePath(project!, specFolder!),
      );
    }
    // The tab the form was on, which is where the textarea is (spec
    // 212). A refusal has to land where the form was, holding what is
    // actually on disk.
    const back = specTabPath(project!, specFolder!, tab);
    // REQ-6: the same job-state gate the tick route already applies —
    // a run works in a worktree branched when it started, so a hand
    // edit cannot corrupt it, but REQ-4 below now writes onto that same
    // branch, and a save racing the run's own commits to it is exactly
    // what this gate exists to prevent.
    const activeJob = ctx.queue.list().some(
      (job) => job.project === project && job.specFolder === specFolder &&
        (job.state === "queued" || job.state === "running"),
    );
    if (activeJob) {
      const reason = "another job for this spec is still running — nothing was saved";
      logRefusal("save", `${project}/${specFolder}`, reason);
      return specsRedirect({}, { error: reason }, back);
    }
    // An EMPTY textarea is a legitimate save — the terminal-edit path
    // this matches has never stopped anyone deleting the lot. A body
    // with no field at all is not: it is a request that never came
    // from this form, and writing it would empty the file.
    if (typeof body.text !== "string") {
      return specsRedirect({}, { error: "no text was submitted — nothing was saved" }, back);
    }
    // REQ-7: dependsOn stays Description-only; the other tabs' forms
    // never send it, and this parsing only ever touches the file the
    // "Depends on" line actually lives in.
    let text = body.text;
    if (file === EDITABLE_SPEC_FILE) {
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
      text = merged;
    }
    const baseSha = typeof body.baseSha === "string" && body.baseSha ? body.baseSha : null;
    // spec 355 (REQ-2): a document-tab Save of 4-status.md itself is as
    // real a write to it as a skill's or the tick route's, and the
    // state file has to stay in step with it too — landed through the
    // same spawned aide-write-spec, in the same commit. Refuses rather
    // than saving with a silently stale state file: the whole point of
    // "only scripts write it" is that nothing else ever computes it.
    let stateEdit: { relPath: string; text: string; baseSha: string | null } | null = null;
    if (file === STATUS_SPEC_FILE) {
      const derived = await runAideWriteSpec(specFolder!, file, text);
      if (!derived.ok || !derived.stateJson) {
        const reason = derived.error ?? "the state file could not be derived";
        logRefusal("save", `${project}/${specFolder}`, reason);
        return specsRedirect({}, { error: `${reason} — nothing was saved` }, back);
      }
      // Nothing edits this file directly, so there is no stale-page race
      // to guard against — only the CURRENT sha, read fresh, so
      // `saveSpecFiles`'s own row-level check (every edit's baseSha must
      // match what is actually there) does not itself refuse a plain
      // update to a file nothing on the page ever showed a baseSha for.
      const currentState = await lastCommitOf(ctx.gitRun, dir, STATE_SPEC_FILE);
      stateEdit = { relPath: "", text: derived.stateJson, baseSha: currentState?.sha ?? null };
    }
    // REQ-4: the same branch-aware choice the tick route already makes
    // for `4-status.md` — an open `aide/<folder>` branch is where an
    // active spec's real, already-committed progress lives, and a
    // write straight to `main` would be silently lost the moment
    // `archive` merges the branch. Read fresh (`true`), never the
    // cached answer: a branch opened moments ago by `create` or
    // `analyze` must be seen by the very next Save press.
    const branchTarget = await resolveOpenBranchTarget(ctx, dir, specFolder!, file, true);
    const result = branchTarget
      ? await ctx.mergeLock.run(branchTarget.root, () =>
          writeStatusToBranch(
            ctx.gitRun,
            branchTarget.root,
            branchTarget.branch,
            [
              { relPath: branchTarget.relPath, text },
              ...(stateEdit ? [{ relPath: stateRelPath(branchTarget.relPath), text: stateEdit.text }] : []),
            ],
            baseSha,
            editMessage(specFolder!, file),
          ),
        )
      : await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
          saveSpecFiles(
            ctx.gitRun,
            dir,
            (root) => ctx.branchStatus.defaultBranch(root),
            [
              { file, text, baseSha },
              // Its own current sha, read fresh above — `null` here told
              // saveSpecFiles the file had never been committed, and every
              // Save refused once the backfill had committed one for each spec.
              ...(stateEdit ? [{ file: STATE_SPEC_FILE, text: stateEdit.text, baseSha: stateEdit.baseSha }] : []),
            ],
            { specLabel: specFolder!, message: editMessage(specFolder!, file) },
          ),
        );
    if (!result.ok) {
      logRefusal("save", `${project}/${specFolder}`, result.note);
      return specsRedirect({}, { error: result.note }, back);
    }
    // Back to the tab the form is on, where the file now carries its
    // new commit stamp. Not the Overview tab it used to land on: since
    // spec 212 the editor IS a tab of this page, and a reader who has
    // just saved is as likely to keep editing.
    return specsRedirect({}, undefined, back, { note: result.note, ok: true });
  }

  return null;
}
