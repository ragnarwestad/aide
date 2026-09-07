// The spec-wide banner's own save route (spec 394): what the spec
// depends on, and whether it requires acceptance ticking — two facts
// that belong to the whole spec, not to any one document tab, and so no
// longer ride on the Description tab's own `/save` (see spec-page.ts's
// now-narrowed route).
import { saveSpecFiles } from "../../../git/specs-pull.ts";
import { readStatusFromBranch, resolveOpenBranchTarget, writeStatusToBranch } from "../../../git/branch-file.ts";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import {
  discoverProjects, specFileText, withAcceptanceLine, withDependsOnLine,
} from "../../../project/discover.ts";
import { parseStatus } from "../../../project/parse-status.ts";
import { EDITABLE_SPEC_FILE, STATUS_SPEC_FILE, specPagePath } from "../../../render.ts";
import {
  ARCHIVED_REFUSAL, MAX_SAVE_BODY, bodyToObject, editMessage, json, logRefusal, readBounded,
  resolveDependencyFolder, specsRedirect,
} from "../../serve-helpers.ts";

import type { HandleQueueContext } from "../../handle-queue.ts";

export async function trackingRoutes(
  ctx: HandleQueueContext,
  req: Request,
  _url: URL,
  path: string,
  _wantsJson: boolean,
): Promise<Response | null> {
  const m = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/tracking$/);
  if (!m) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const [, project, specFolder] = m;
  const found = ctx.specDir(project!, specFolder!);
  if (!found) return new Response("not found", { status: 404 });
  const dir = await ctx.machinerySpecDir(project!, found);
  const back = specPagePath(project!, specFolder!);

  // Before the body is even read: this one WRITES, commits and pushes,
  // and an archived spec's folder is in `archive/` — the same refusal
  // `/save` makes before reading its own body.
  if (ctx.specRef(project!, specFolder!)?.archived) {
    logRefusal("tracking", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
    return specsRedirect({}, { error: ARCHIVED_REFUSAL }, back);
  }
  // The same job-state gate `/save` applies (REQ-6 of spec 310): a run
  // works in a worktree branched when it started, but a hand edit
  // racing the run's own commits to the SAME branch is exactly what
  // this gate exists to prevent.
  const activeJob = ctx.queue.list().some(
    (job) => job.project === project && job.specFolder === specFolder &&
      (job.state === "queued" || job.state === "running"),
  );
  if (activeJob) {
    const reason = "another job for this spec is still running — nothing was saved";
    logRefusal("tracking", `${project}/${specFolder}`, reason);
    return specsRedirect({}, { error: reason }, back);
  }

  const sent = await readBounded(req, MAX_SAVE_BODY);
  if ("refusal" in sent) return sent.refusal;
  let body: Record<string, unknown> = {};
  try {
    if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed body" }, 400);
  }

  // This form carries no textarea — it is not one document's Save — so
  // it reads `1-description.md` fresh itself, the same "ask the open
  // branch first" question `/save`'s own REQ-4 asks, since `create` or
  // `analyze` may have already pushed this spec's own branch.
  const target = await resolveOpenBranchTarget(ctx, dir, specFolder!, EDITABLE_SPEC_FILE, true);
  const branchRead = target
    ? await readStatusFromBranch(ctx.gitRun, target.root, target.branch, target.relPath)
    : null;
  const currentSha = branchRead ? branchRead.sha : (await lastCommitOf(ctx.gitRun, dir, EDITABLE_SPEC_FILE))?.sha ?? null;
  const currentText = branchRead ? branchRead.text : specFileText(dir, EDITABLE_SPEC_FILE);
  if (currentText === null) {
    return specsRedirect({}, { error: "1-description.md could not be read — nothing was saved" }, back);
  }

  // This form carries no `baseSha` of its own — it is not one document's
  // Save, and the file it writes is `1-description.md` whatever tab the
  // reader is on, while the page's own `formBaseSha` belongs to the tab.
  // Absent means "no check", which is what the comparison below already
  // says; passing the null straight on to the write made every save
  // refuse, because a real sha never equals null.
  const sentSha = typeof body.baseSha === "string" && body.baseSha ? body.baseSha : null;
  if (sentSha !== null && sentSha !== currentSha) {
    return specsRedirect(
      {},
      { error: "the description changed since you opened this page — reload and try again" },
      back,
    );
  }
  // What the write compares against: what this route just read, when the
  // form sent nothing to compare. A branch that moves between that read
  // and the write is still refused there.
  const baseSha = sentSha ?? currentSha;

  // Depends on — the same validation `/save` used to make inline
  // (`resolveDependencyFolder`, which takes a bare number or a full
  // folder and sees archived specs too) — so a dependency this route
  // accepts is one the runtime gate can read. Refused entry by entry,
  // never filtered: a typo left to drop out silently is a dead gate
  // nobody is told about.
  const ids = (Array.isArray(body.dependsOn) ? body.dependsOn : body.dependsOn === undefined ? [] : [body.dependsOn])
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 0) {
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
  let text = withDependsOnLine(currentText, ids);
  if (text === null) {
    return specsRedirect(
      {},
      { error: `nowhere to put "Depends on" — Tracking info has no Created line — nothing was saved` },
      back,
    );
  }

  // Acceptance — REQ-6: only touched when the form was actually drawn
  // editable. `acceptanceEditable` is a hidden sentinel posted ONLY by
  // the unlocked render (`overview.ts`'s `trackingControl`): an
  // unchecked box and a LOCKED box both submit no `acceptanceNotRequired`
  // field at all, and only this sentinel tells the two apart — without
  // it, "the field is absent" could not tell "required" from "analyze
  // already decided, leave it alone".
  if (body.acceptanceEditable === "1") {
    const statusTarget = await resolveOpenBranchTarget(ctx, dir, specFolder!, STATUS_SPEC_FILE, false);
    const statusRead = statusTarget
      ? await readStatusFromBranch(ctx.gitRun, statusTarget.root, statusTarget.branch, statusTarget.relPath)
      : null;
    const statusText = statusRead ? statusRead.text : (specFileText(dir, STATUS_SPEC_FILE) ?? "");
    const analyzeDone = parseStatus(statusText).workflowSteps.includes("analyze");
    if (analyzeDone) {
      return specsRedirect(
        {},
        { error: "analyze has already decided whether to write the acceptance-criteria table — this cannot change now" },
        back,
      );
    }
    // The box says what it means: ticked is required. Absent is a
    // cleared box, which is "not required" — and `acceptanceEditable`
    // above is what tells that apart from a LOCKED box, which submits
    // nothing either.
    const acceptanceRequired = body.acceptanceRequired === "1" || body.acceptanceRequired === true;
    const acceptanceNotRequired = !acceptanceRequired;
    const withAccept = withAcceptanceLine(text, acceptanceNotRequired);
    if (withAccept === null) {
      return specsRedirect(
        {},
        { error: `nowhere to put "Acceptance" — Tracking info has no Created line — nothing was saved` },
        back,
      );
    }
    text = withAccept;
  }

  const result = target
    ? await ctx.mergeLock.run(target.root, () =>
        writeStatusToBranch(
          ctx.gitRun, target.root, target.branch,
          [{ relPath: target.relPath, text: text! }],
          baseSha,
          editMessage(specFolder!, EDITABLE_SPEC_FILE),
        ),
      )
    : await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
        saveSpecFiles(
          ctx.gitRun, dir, (root) => ctx.branchStatus.defaultBranch(root),
          [{ file: EDITABLE_SPEC_FILE, text: text!, baseSha }],
          { specLabel: specFolder!, message: editMessage(specFolder!, EDITABLE_SPEC_FILE) },
        ),
      );
  if (!result.ok) {
    logRefusal("tracking", `${project}/${specFolder}`, result.note);
    return specsRedirect({}, { error: result.note }, back);
  }
  return specsRedirect({}, undefined, back, { note: result.note, ok: true });
}
