// The spec-wide banner's own save route: what the spec
// depends on, and whether it requires acceptance ticking — two facts
// that belong to the whole spec, not to any one document tab, and so no
// longer ride on the Description tab's own `/save` (see spec-page.ts's
// now-narrowed route).
import { readStatusFromBranch, resolveOpenBranchTarget } from "../../../git/branch-file.ts";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import {
  chooseApproachIn, createChoicesIn, dependsOnIn, discoverProjects, groupIn, manifestInside, parseCriteriaChecks, specFileText, withAcceptanceLine,
  withChooseApproachLine, withCriteriaChecksLine, withDependsOnLine,
} from "../../../project/discover";
import { parseStatus } from "../../../project/parse-status";
import { cardStep } from "../../../project/spec-card.ts";
import { inFlight } from "../../../queue/queue.ts";
import { EDITABLE_SPEC_FILE, STATUS_SPEC_FILE } from "../../../render";
import { workRoundJobs } from "../../spec-views/work-round.ts";
import {
  ARCHIVED_REFUSAL, MAX_SAVE_BODY, json, logRefusal, readObjectBody, refusal,
  resolveDependencyFolder,
} from "../../serve-helpers";

import { writeSpecFile } from "./shared.ts";
import { stoppedAnalyzeGoesOn } from "../../dependencies";
import { enqueueRequest, followOnRequest } from "../../../queue/request/index.ts";

import type { RoutesContext } from "..";

// This form carries no textarea — it is not one document's Save — so
// it reads `1-description.md` fresh itself, the same "ask the open
// branch first" question `/save` asks, since `create` or
// `analyze` may have already pushed this spec's own branch. `4-status.md`
// is read the same way: whether analyze has run is a fact of the card.
export async function readTrackingFiles(ctx: RoutesContext, dir: string, specFolder: string) {
  const target = await resolveOpenBranchTarget(ctx, dir, specFolder!, EDITABLE_SPEC_FILE, true);
  const branchRead = target
    ? await readStatusFromBranch(ctx.gitRun, target.root, target.branch, target.relPath)
    : null;
  const currentSha = branchRead ? branchRead.sha : (await lastCommitOf(ctx.gitRun, dir, EDITABLE_SPEC_FILE))?.sha ?? null;
  const currentText = branchRead ? branchRead.text : specFileText(dir, EDITABLE_SPEC_FILE);
  const statusTarget = await resolveOpenBranchTarget(ctx, dir, specFolder!, STATUS_SPEC_FILE, false);
  const statusRead = statusTarget
    ? await readStatusFromBranch(ctx.gitRun, statusTarget.root, statusTarget.branch, statusTarget.relPath)
    : null;
  const statusText = statusRead ? statusRead.text : (specFileText(dir, STATUS_SPEC_FILE) ?? "");
  const completedSteps = parseStatus(statusText).workflowSteps;

  return { target, currentSha, currentText, completedSteps };
}

// What can be changed is the card's to say (`project/spec-card.ts`), the
// same answer the Running row is drawn from. The job-state gate `/save`
// applies: a run works in a worktree branched when it
// started, but a hand edit racing the run's own commits to the SAME branch
// is exactly what this gate exists to prevent. A landing counts as a job
// in flight, as it does on the row.
function trackingView(ctx: RoutesContext, project: string, specFolder: string, currentText: string | null, completedSteps: string[]) {
  const jobInFlight = ctx.queue.list().some((job) => job.project === project && job.specFolder === specFolder && inFlight(job));
  return cardStep(undefined, {
    type: "opened",
    facts: {
      place: "running-row",
      jobInFlight,
      analyzeRun: completedSteps.includes("analyze"),
      started: completedSteps.some((step) => step !== "create"),
    },
    saved: { dependsOn: dependsOnIn(currentText ?? ""), group: groupIn(currentText ?? "") ?? null, ...createChoicesIn(currentText ?? "") },
  }).view;
}

// Depends on, only when the request names it: the spec page's form posts
// the acceptance switch alone, and leaves the line as it is. The same
// validation `/save` used to make inline (`resolveDependencyFolder`,
// which takes a bare number or a full folder and sees archived specs
// too), so a dependency this route accepts is one the runtime gate can
// read. Refused entry by entry, never filtered: a typo left to drop out
// silently is a dead gate nobody is told about.
function withDependsOn(
  ctx: RoutesContext, project: string, specFolder: string, body: Record<string, unknown>, text: string,
): { text: string; depFolders: string[] } | { error: string } {
  const depFolders: string[] = [];
  if (body.dependsOn === undefined) return { text, depFolders };
  const ids = (Array.isArray(body.dependsOn) ? body.dependsOn : [body.dependsOn])
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 0) {
    const discovered = ctx.opts.projectRoot
      ? discoverProjects(ctx.opts.projectRoot, undefined, manifestInside(ctx.machineryProjectDir)).find((p) => p.name === project)
      : undefined;
    if (!discovered) return refusedWith("unknown project — nothing was saved");
    for (const id of ids) {
      const dep = resolveDependencyFolder(discovered, id);
      if (!dep) {
        return refusedWith(`no such spec in this project: ${id} — nothing was saved`);
      }
      if (dep.folder === specFolder) {
        return refusedWith(`a spec cannot depend on itself: ${id} — nothing was saved`);
      }
      depFolders.push(dep.folder);
    }
  }
  const next = withDependsOnLine(text, ids);
  if (next === null) {
    return refusedWith(`nowhere to put "Depends on" — Tracking info has no Created line — nothing was saved`);
  }
  return { text: next, depFolders };
}

// The settings analyze reads — acceptance, the checks level and
// choosing the approach — only touched when the form was actually drawn
// editable. `settingsEditable` is a hidden sentinel posted ONLY by
// the unlocked render (`overview.ts`'s `trackingControl`): an
// unchecked box and a LOCKED box both submit nothing at all, and only
// this sentinel tells the two apart — without it, "the field is absent"
// could not tell "cleared" from "analyze already decided, leave it
// alone".
function withSettings(body: Record<string, unknown>, view: ReturnType<typeof trackingView>, text: string): string | { error: string } {
  if (body.settingsEditable !== "1") return text;
  if (view.locks.acceptanceRequired === "analyze-run") {
    return refusedWith("analyze has already run on these settings — they cannot change now");
  }
  // The box says what it means: ticked is required. Absent is a
  // cleared box, which is "not required" — and `settingsEditable`
  // above is what tells that apart from a LOCKED box, which submits
  // nothing either.
  const acceptanceRequired = body.acceptanceRequired === "1" || body.acceptanceRequired === true;
  const acceptanceNotRequired = !acceptanceRequired;
  const withAccept = withAcceptanceLine(text, acceptanceNotRequired);
  if (withAccept === null) {
    return refusedWith(`nowhere to put "Acceptance" — Tracking info has no Created line — nothing was saved`);
  }
  text = withAccept;
  // The other two settings analyze reads, under the same rule: the
  // checks level, and whether to choose the approach (a cleared box
  // posts nothing, which is no). Each written only when it changes, so
  // a spec with no line keeps having none.
  const checks = parseCriteriaChecks(body.criteriaChecks);
  if ("error" in checks) return refusedWith(`${checks.error} — nothing was saved`);
  if (checks.level && checks.level !== createChoicesIn(text).criteriaChecks) {
    const withChecks = withCriteriaChecksLine(text, checks.level);
    if (withChecks === null) {
      return refusedWith(`nowhere to put "Acceptance criteria checks" — Tracking info has no Created line — nothing was saved`);
    }
    text = withChecks;
  }
  const choose = body.chooseApproach === "1" || body.chooseApproach === true;
  if (choose !== chooseApproachIn(text)) {
    const withChoose = withChooseApproachLine(text, choose);
    if (withChoose === null) {
      return refusedWith(`nowhere to put "Let me choose the approach" — Tracking info has no Created line — nothing was saved`);
    }
    text = withChoose;
  }
  return text;
}

// An analyze that stopped on files another open spec changes goes on
// once Depends on names one of the specs it named: Analyze is queued
// with the steps the stopped job had left, and the dependency hold keeps
// it waiting until that spec archives.
async function queueStoppedAnalyze(ctx: RoutesContext, project: string, specFolder: string, depFolders: string[]): Promise<string | undefined> {
  const lead = workRoundJobs(ctx.queue, project, specFolder)[0];
  const named = new Set(
    (lead && stoppedAnalyzeGoesOn(ctx.queue, lead) ? (lead.results.at(-1)?.sharedFiles ?? []) : []).map((s) => s.spec),
  );
  if (lead && depFolders.some((folder) => named.has(folder))) {
    const queued = enqueueRequest(
      ctx.queue,
      followOnRequest(project, specFolder, lead.steps.slice(lead.stepIndex), lead),
      "manual",
    );
    if (!queued.ok) {
      logRefusal("tracking", `${project}/${specFolder}`, queued.error);
      return `Depends on was saved, but analyze could not be queued: ${queued.error}`;
    }
    await ctx.tickRunner();
  }
  return undefined;
}

const refusedWith = (error: string) => ({ error });

// The spec named in a refusal, as `/approach` and `/model` name it, so
// the Running tab writes it under the row it was pressed on.
//
// Before the body is even read: this one WRITES, commits and pushes,
// and an archived spec's folder is in `archive/` — the same refusal
// `/save` makes before reading its own body.
//
// This form carries no `baseSha` of its own — it is not one document's
// Save, and the file it writes is `1-description.md` whatever tab the
// reader is on, while the page's own `formBaseSha` belongs to the tab.
// Absent means "no check", which is what the comparison below already
// says; passing the null straight on to the write made every save
// refuse, because a real sha never equals null.
// What the write compares against: what this route just read, when the
// form sent nothing to compare. A branch that moves between that read
// and the write is still refused there.
//
// The row's own line reads the same copy this save wrote.
export async function trackingRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  const m = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/tracking$/);
  if (!m) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const [, project, specFolder] = m;
  const found = ctx.specDir(project!, specFolder!);
  if (!found) return new Response("not found", { status: 404 });
  const dir = await ctx.machinerySpecDir(project!, found);
  const spec = `${project}/${specFolder}`;
  const refuse = (error: string, solution?: string): Response => refusal({ error, solution }, { spec });
  if (ctx.specRef(project!, specFolder!)?.archived) {
    logRefusal("tracking", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
    return refuse(ARCHIVED_REFUSAL);
  }
  const { target, currentSha, currentText, completedSteps } = await readTrackingFiles(ctx, dir, specFolder!);
  const view = trackingView(ctx, project!, specFolder!, currentText, completedSteps);
  if (view.locks.dependsOn === "job-in-flight") {
    const reason = "another job for this spec is still running — nothing was saved";
    logRefusal("tracking", `${project}/${specFolder}`, reason);
    return json({ error: reason, spec }, 409);
  }
  const sent = await readObjectBody(req, { cap: MAX_SAVE_BODY });
  if ("refusal" in sent) return sent.refusal;
  const body = sent.body;
  if (currentText === null) {
    return refuse(`${EDITABLE_SPEC_FILE} could not be read — nothing was saved`);
  }
  const sentSha = typeof body.baseSha === "string" && body.baseSha ? body.baseSha : null;
  if (sentSha !== null && sentSha !== currentSha) {
    return refuse("the description changed since you opened this page", "reload and try again");
  }
  const baseSha = sentSha ?? currentSha;
  const deps = withDependsOn(ctx, project!, specFolder!, body, currentText);
  if ("error" in deps) return refuse(deps.error);
  const { depFolders } = deps;
  const text = withSettings(body, view, deps.text);
  if (typeof text !== "string") return refuse(text.error);
  const result = await writeSpecFile(
    ctx,
    { dir, specFolder: specFolder!, file: EDITABLE_SPEC_FILE, branch: target },
    text,
    baseSha,
  );
  if (!result.ok) {
    logRefusal("tracking", `${project}/${specFolder}`, result.note);
    return refuse(result.note);
  }
  const followError = await queueStoppedAnalyze(ctx, project!, specFolder!, depFolders);
  if (followError) return refuse(followError);
  return json({ ok: true, note: result.note, changed: (result as { committed?: boolean }).committed !== false });
}
