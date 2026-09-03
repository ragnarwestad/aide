// The spec's own pages and their edit routes: the reset page and
// its POST, the spec page itself, and update/save/tick. Extracted
// from handle-queue.ts (split of split serve.ts step 2).
import { pullFastForward, saveSpecFiles } from "../../git/specs-pull.ts";
import { readStatusFromBranch, resolveOpenBranchTarget, writeStatusToBranch } from "../../git/branch-file.ts";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { runAideWriteSpec } from "../../git/run-aide-write-spec.ts";
import { discoverProjects, specFileText, withDependsOnLine } from "../../project/discover.ts";
import { acceptanceCriteriaUnticked, clearArchiveHeldBack, tickStatusLine } from "../../project/parse-status.ts";

// spec 355: 4-status.json, the sibling `aide-write-spec` derives and
// writes beside 4-status.md every time that file lands through it —
// never a `--file` a caller names on its own.
const STATE_SPEC_FILE = "4-status.json";
const stateRelPath = (statusRelPath: string): string => statusRelPath.replace(/4-status\.md$/, STATE_SPEC_FILE);
import {
  EDITABLE_SPEC_FILE, FILE_TABS, STATUS_SPEC_FILE, documentTabScript, renderResetSpecPage, renderSpecPage,
  resolveBackHref, resolveSpecTab, specPagePath, specTabPath,
} from "../../render.ts";
import { ARCHIVED_REFUSAL, MAX_SAVE_BODY, SPEC_EDITOR_ASSET_PATH, SPEC_VIEWER_ASSET_PATH, bodyToObject, editMessage, json, logRefusal, queueClientScript, readBounded, resolveDependencyFolder, specsRedirect, tickMessage } from "../serve-helpers.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

export async function handleSpecEditRoutes(
  ctx: HandleQueueContext,
  req: Request,
  url: URL,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
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
        script: await queueClientScript(),
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

  // Spec 308: a model picked for a phase before any job exists — the
  // spec-scoped sibling of `POST /api/queue/:id/model` (job-actions.ts),
  // which needs a job to attach the pick to and this route does not.
  const modelPost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/model$/);
  if (modelPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = modelPost;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const spec = `${project}/${specFolder}`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    if (ref.archived) {
      logRefusal("model", spec, ARCHIVED_REFUSAL);
      return wantsJson ? json({ error: ARCHIVED_REFUSAL, spec }, 400) : specsRedirect(body, { error: ARCHIVED_REFUSAL, spec });
    }
    const step = typeof body.step === "string" ? body.step : "";
    const model = typeof body.model === "string" ? body.model : "";
    const result = ctx.queue.setPendingModel(project!, specFolder!, step, model);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return wantsJson ? json({ error: result.error, spec }, 400) : specsRedirect(body, { error: result.error, spec });
    }
    return wantsJson ? json({ ok: true }) : specsRedirect(body);
  }

  // Spec 364: the effort-level sibling of the model pending pick above —
  // same shape, same reason, checked against EFFORT_LEVELS instead of
  // a configured allowlist.
  const effortPost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/effort$/);
  if (effortPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = effortPost;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const spec = `${project}/${specFolder}`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    if (ref.archived) {
      logRefusal("effort", spec, ARCHIVED_REFUSAL);
      return wantsJson ? json({ error: ARCHIVED_REFUSAL, spec }, 400) : specsRedirect(body, { error: ARCHIVED_REFUSAL, spec });
    }
    const step = typeof body.step === "string" ? body.step : "";
    const effort = typeof body.effort === "string" ? body.effort : "";
    const result = ctx.queue.setPendingEffort(project!, specFolder!, step, effort);
    if (!result.ok) {
      logRefusal("effort", spec, result.error);
      return wantsJson ? json({ error: result.error, spec }, 400) : specsRedirect(body, { error: result.error, spec });
    }
    return wantsJson ? json({ ok: true }) : specsRedirect(body);
  }

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
      return specsRedirect({}, { error: ARCHIVED_REFUSAL }, specTabPath(project!, specFolder!, "checks"));
    }
    const activeJob = ctx.queue.list().some(
      (job) => job.project === project && job.specFolder === specFolder &&
        (job.state === "queued" || job.state === "running"),
    );
    if (activeJob) {
      const reason = "another job for this spec is still running — nothing was saved";
      logRefusal("tick", `${project}/${specFolder}`, reason);
      return specsRedirect({}, { error: reason }, specTabPath(project!, specFolder!, "checks"));
    }
    const sent = await readBounded(req, MAX_SAVE_BODY);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // The Checks tab (renamed from Overview by spec 294), which is
    // where the boxes are — not the bare spec path, which spec 294
    // also made default to Description instead.
    const back = specTabPath(project!, specFolder!, "checks");
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
    // REQ-1/REQ-4/REQ-6: the same "is this branch open" question the
    // read side asks (`resolveOpenBranchTarget`) — but FRESH, never the
    // cached answer. A branch opened moments ago by `create` or
    // `analyze` must be seen by the very next Save press, or the write
    // silently falls through to `saveSpecFiles`/`main` — the exact bug
    // this spec fixes, reintroduced on the write side by a stale cache
    // hit (see 3-solution.md's Plan review, Coherence's must-fix).
    const branchTarget = await resolveOpenBranchTarget(ctx, dir, specFolder!, STATUS_SPEC_FILE, true);
    // The row-level guard, on top of the file-level `baseSha` one
    // below. A `null` is every way the page can be out of date at
    // once: no such phase, no such row inside it, or a row someone
    // has already ticked in the very commit the page was drawn from
    // — which a sha alone cannot tell from a fresh render.
    //
    // Read fresh off the branch when one is open — never trusting the
    // page's own copy, since a headless run may have moved the branch
    // since the page was drawn — and off disk otherwise, exactly as
    // before REQ-1.
    //
    // Chained one row after another, which is safe because exactly
    // one character moves per tick and the cell keeps its padding:
    // a tick never reflows the table, so every other row's text is
    // still what it was.
    let ticked = branchTarget
      ? ((await readStatusFromBranch(ctx.gitRun, branchTarget.root, branchTarget.branch, branchTarget.relPath))
          ?.text ?? "")
      : (specFileText(dir, STATUS_SPEC_FILE) ?? "");
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
    // The ACCEPTANCE rows, not the whole file's: the Phase tables gate
    // nothing (archive's only gate has been the Acceptance section since
    // spec 268), so an implement run that left one of its own rows
    // unticked used to keep the note — and the "held back" wording with
    // it — standing on a spec whose person had judged everything that
    // was theirs to judge.
    if (!acceptanceCriteriaUnticked(ticked)) {
      const cleared = clearArchiveHeldBack(ticked);
      if (cleared !== null) ticked = cleared;
    }
    const statusBaseSha = typeof body.statusBaseSha === "string" && body.statusBaseSha ? body.statusBaseSha : null;
    // spec 355 (REQ-4): the tick lands through the same spawned
    // aide-write-spec every skill's own write already goes through —
    // never a second, TypeScript-side computation of the derived state.
    // Refuses rather than ticking with a state file that would fall out
    // of step with what was just ticked.
    const derived = await runAideWriteSpec(specFolder!, STATUS_SPEC_FILE, ticked);
    if (!derived.ok || !derived.stateJson) {
      const reason = derived.error ?? "the state file could not be derived";
      logRefusal("tick", `${project}/${specFolder}`, reason);
      return specsRedirect({}, { error: `${reason} — nothing was saved` }, back);
    }
    const currentState = await lastCommitOf(ctx.gitRun, dir, STATE_SPEC_FILE);
    // REQ-4: an open branch writes straight onto `refs/heads/aide/<folder>`
    // at origin — never through `saveSpecFiles`, which structurally
    // cannot target anything but the shared checkout's own `HEAD`
    // (see 2-analysis.md's "The write side"). No open branch keeps the
    // exact `saveSpecFiles` call this route has always made (REQ-2).
    // Both cases now land `4-status.md` and `4-status.json` together, in
    // the ONE commit the tick makes.
    const result = branchTarget
      ? await ctx.mergeLock.run(branchTarget.root, () =>
          writeStatusToBranch(
            ctx.gitRun,
            branchTarget.root,
            branchTarget.branch,
            [
              { relPath: branchTarget.relPath, text: ticked },
              { relPath: stateRelPath(branchTarget.relPath), text: derived.stateJson! },
            ],
            statusBaseSha,
            tickMessage(specFolder!),
          ),
        )
      : await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
          saveSpecFiles(
            ctx.gitRun,
            dir,
            (root) => ctx.branchStatus.defaultBranch(root),
            [
              { file: STATUS_SPEC_FILE, text: ticked, baseSha: statusBaseSha },
              { file: STATE_SPEC_FILE, text: derived.stateJson!, baseSha: currentState?.sha ?? null },
            ],
            { specLabel: specFolder!, message: tickMessage(specFolder!) },
          ),
        );
    if (!result.ok) {
      logRefusal("tick", `${project}/${specFolder}`, result.note);
      return specsRedirect({}, { error: result.note }, back);
    }
    return specsRedirect({}, undefined, back, { note: result.note, ok: true });
  }

  return null;
}
