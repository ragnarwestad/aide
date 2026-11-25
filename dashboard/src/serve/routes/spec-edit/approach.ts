// The Save under a row's approach warning: the approach a person chose
// among the real alternatives a ticked spec's analysis found, written into
// `3-solution.md` as `**Chosen approach:** Approach X`. The recommended
// one lets a job held for the choice carry on at the next tick; another
// one has analyze plan it, in a job that takes over the held job's
// remaining steps. One of the families `handleSpecEditRoutes` asks in
// turn; answers JSON only, read by the page script.
import { writeSpecFile } from "./shared.ts";
import { readStatusFromBranch, resolveOpenBranchTarget } from "../../../git/branch-file.ts";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { chooseApproachIn, specFileText } from "../../../project/discover";
import { parseApproaches, pendingChoice, withChosenApproach } from "../../../project/approach-choice.ts";
import { ARCHIVED_REFUSAL, json, logRefusal, readObjectBody, refusal } from "../../serve-helpers";
import { writing } from "../../../queue/queue.ts";
import { endStep } from "../../../queue/runner/step-result.ts";
import { enqueueRequest, followOnRequest } from "../../../queue/request/index.ts";

import type { RoutesContext } from "..";
import { DESCRIPTION_FILE, SOLUTION_FILE } from "../../../project/spec-names.ts";
import type { Job } from "../../../queue/types.ts";

/** The plan, read fresh from the open branch when there is one. */
async function readSolution(ctx: RoutesContext, dir: string, specFolder: string) {
  const branchTarget = await resolveOpenBranchTarget(ctx, dir, specFolder, SOLUTION_FILE, true);
  const branchRead = branchTarget
    ? await readStatusFromBranch(ctx.gitRun, branchTarget.root, branchTarget.branch, branchTarget.relPath)
    : null;
  const solution = branchTarget ? (branchRead?.text ?? "") : (specFileText(dir, SOLUTION_FILE) ?? "");
  return { branchTarget, branchRead, solution };
}

/** The job held for the choice, cancelled when another approach is chosen;
 *  a refusal's words, with its solution after a `|`, when it cannot be. */
function cancelHeldForChoice(ctx: RoutesContext, ours: Job[], recommended: boolean): Job | undefined | string {
  // Another approach replaces the job held for the choice with one that
  // starts with analyze. Any other job still waiting for this spec would
  // clash with that one, so it is refused before anything is changed.
  const held = recommended
    ? undefined
    : ours.find((job) => job.state === "queued" && job.steps[job.stepIndex] === "implement");
  if (!recommended && ours.some((job) => job.state === "queued" && job !== held)) {
    return "another job for this spec is waiting|cancel it first, then save again";
  }
  // Cancelled BEFORE the write: a tick between the two would otherwise
  // find the choice recorded, release the hold, and start implement on
  // the plan that was not chosen.
  if (held) {
    const cancelled = endStep(ctx.queue, held.id, "cancel", {
      finishedAt: new Date().toISOString(),
      error: undefined,
      errorReason: undefined,
    });
    if (!cancelled.ok) return "the held run could not be cancelled — nothing was saved";
  }
  return held;
}

export async function approachRoutes(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const m = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/approach$/);
  if (!m) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const [, project, specFolder] = m;
  const found = ctx.specDir(project!, specFolder!);
  if (!found) return new Response("not found", { status: 404 });
  const dir = await ctx.machinerySpecDir(project!, found);
  const spec = `${project}/${specFolder}`;
  const refuse = (error: string, solution?: string): Response => {
    logRefusal("approach", spec, solution ? `${error} — ${solution}` : error);
    return refusal({ error, solution }, { spec }, 409);
  };
  if (ctx.specRef(project!, specFolder!)?.archived) return refuse(ARCHIVED_REFUSAL);
  // A step running or landing is writing the plan this would write into.
  // A job merely queued — the one held for this very choice — is not.
  const ours = ctx.queue.list().filter((job) => job.project === project && job.specFolder === specFolder);
  if (ours.some(writing)) return refuse("another job for this spec is still running — nothing was saved");

  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const body = sent.body;
  const letter = typeof body.approach === "string" ? body.approach : "";
  if (!/^[A-Z]$/.test(letter)) return json({ error: "no approach was chosen — nothing was saved", spec }, 400);

  // Read fresh, from the open branch when there is one, as the tick reads
  // the status file: the plan analyze wrote is there before it lands.
  const { branchTarget, branchRead, solution } = await readSolution(ctx, dir, specFolder!);
  const pending = pendingChoice(chooseApproachIn(specFileText(dir, DESCRIPTION_FILE) ?? ""), parseApproaches(solution));
  const picked = pending?.find((a) => a.letter === letter);
  if (!picked) return refuse("there is no approach to choose here any more", "reload the page");

  const recommended = picked.mark === "recommended";
  const held = cancelHeldForChoice(ctx, ours, recommended);
  if (typeof held === "string") return refuse(...(held.split("|") as [string, string?]));

  const text = withChosenApproach(solution, letter);
  const baseSha = branchTarget
    ? (branchRead?.sha ?? null)
    : ((await lastCommitOf(ctx.gitRun, dir, SOLUTION_FILE))?.sha ?? null);
  const target = { dir, specFolder: specFolder!, file: SOLUTION_FILE, branch: branchTarget };
  const result = await writeSpecFile(ctx, target, text, baseSha);
  if (!result.ok) {
    return held ? refuse(`${result.note}; the held run was cancelled`, "press Save again") : refuse(result.note);
  }

  if (!recommended) {
    const queued = enqueueRequest(ctx.queue, followOnRequest(
      project!,
      specFolder!,
      held ? ["analyze", ...held.steps.slice(held.stepIndex)] : ["analyze"],
      held,
    ), "manual");
    if (!queued.ok) return refuse(`the choice was saved, but analyze could not be queued: ${queued.error}`);
  }
  await ctx.tickRunner();
  return json({ ok: true, note: result.note, changed: (result as { committed?: boolean }).committed !== false });
}
