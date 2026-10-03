// The Save under a row's approach warning: the approach a person chose
// among the real alternatives a ticked spec's analysis found, written into
// `3-solution.md` as `**Chosen approach:** Approach X`. The recommended
// one lets a job held for the choice carry on at the next tick; another
// one has analyze plan it, in a job that takes over the held job's
// remaining steps. One of the families `handleSpecEditRoutes` asks in
// turn; answers JSON only, read by the page script.
import { saveSpecFiles } from "../../../git/specs-pull.ts";
import { readStatusFromBranch, resolveOpenBranchTarget, writeStatusToBranch } from "../../../git/branch-file.ts";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { chooseApproachIn, specFileText } from "../../../project/discover";
import { parseApproaches, pendingChoice, withChosenApproach } from "../../../project/approach-choice.ts";
import type { Job } from "../../../queue/types.ts";
import { ARCHIVED_REFUSAL, bodyToObject, editMessage, json, logRefusal, readBounded } from "../../serve-helpers";
import { specWriteInFlight } from "./shared.ts";
import { afterTick } from "./checks.ts";

import type { RoutesContext } from "..";

const SOLUTION_FILE = "3-solution.md";

export async function approachRoutes(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const m = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/approach$/);
  if (!m) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const [, project, specFolder] = m;
  const found = ctx.specDir(project!, specFolder!);
  if (!found) return new Response("not found", { status: 404 });
  const dir = await ctx.machinerySpecDir(project!, found);
  const spec = `${project}/${specFolder}`;
  const refuse = (error: string): Response => {
    logRefusal("approach", spec, error);
    return json({ error, spec }, 409);
  };
  if (ctx.specRef(project!, specFolder!)?.archived) return refuse(ARCHIVED_REFUSAL);
  // A step running or landing is writing the plan this would write into.
  // A job merely queued — the one held for this very choice — is not.
  const ours = ctx.queue.list().filter((job) => job.project === project && job.specFolder === specFolder);
  if (ours.some(specWriteInFlight)) return refuse("another job for this spec is still running — nothing was saved");

  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  let body: Record<string, unknown> = {};
  try {
    if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed body" }, 400);
  }
  const letter = typeof body.approach === "string" ? body.approach : "";
  if (!/^[A-Z]$/.test(letter)) return json({ error: "no approach was chosen — nothing was saved", spec }, 400);

  // Read fresh, from the open branch when there is one, as the tick reads
  // the status file: the plan analyze wrote is there before it lands.
  const branchTarget = await resolveOpenBranchTarget(ctx, dir, specFolder!, SOLUTION_FILE, true);
  const branchRead = branchTarget
    ? await readStatusFromBranch(ctx.gitRun, branchTarget.root, branchTarget.branch, branchTarget.relPath)
    : null;
  const solution = branchTarget ? (branchRead?.text ?? "") : (specFileText(dir, SOLUTION_FILE) ?? "");
  const pending = pendingChoice(chooseApproachIn(specFileText(dir, "1-description.md") ?? ""), parseApproaches(solution));
  const picked = pending?.find((a) => a.letter === letter);
  if (!picked) return refuse("there is no approach to choose here any more — reload the page");

  const recommended = picked.mark === "recommended";
  // Another approach replaces the job held for the choice with one that
  // starts with analyze. Any other job still waiting for this spec would
  // clash with that one, so it is refused before anything is changed.
  const held = recommended
    ? undefined
    : ours.find((job) => job.state === "queued" && job.steps[job.stepIndex] === "implement");
  if (!recommended && ours.some((job) => job.state === "queued" && job !== held)) {
    return refuse("another job for this spec is waiting — cancel it first, then save again");
  }
  // Cancelled BEFORE the write: a tick between the two would otherwise
  // find the choice recorded, release the hold, and start implement on
  // the plan that was not chosen.
  if (held) {
    const cancelled = ctx.queue.transition(held.id, "cancel", {
      finishedAt: new Date().toISOString(),
      error: undefined,
      errorReason: undefined,
    });
    if (!cancelled.ok) return refuse("the held run could not be cancelled — nothing was saved");
  }

  const text = withChosenApproach(solution, letter);
  const baseSha = branchTarget
    ? (branchRead?.sha ?? null)
    : ((await lastCommitOf(ctx.gitRun, dir, SOLUTION_FILE))?.sha ?? null);
  const result = branchTarget
    ? await ctx.mergeLock.run(branchTarget.root, () =>
        writeStatusToBranch(
          ctx.gitRun,
          branchTarget.root,
          branchTarget.branch,
          [{ relPath: branchTarget.relPath, text }],
          baseSha,
          editMessage(specFolder!, SOLUTION_FILE),
        ),
      )
    : await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
        saveSpecFiles(
          ctx.gitRun,
          dir,
          (root) => ctx.branchStatus.defaultBranch(root),
          [{ file: SOLUTION_FILE, text, baseSha }],
          { specLabel: specFolder!, message: editMessage(specFolder!, SOLUTION_FILE) },
        ),
      );
  if (!result.ok) {
    return refuse(held ? `${result.note} — the held run was cancelled; press Save again` : result.note);
  }

  if (!recommended) {
    const queued = ctx.queue.enqueue(reanalysis(project!, specFolder!, held));
    if (!queued.ok) return refuse(`the choice was saved, but analyze could not be queued: ${queued.error}`);
  }
  await afterTick(ctx, dir, specFolder!);
  await ctx.tickRunner();
  return json({ ok: true, note: result.note, changed: (result as { committed?: boolean }).committed !== false });
}

/** Analyze for the chosen approach, then the steps the held job had left,
 *  on the models and effort it would have run them with. The timeouts are
 *  not carried: a job takes those from Settings. */
function reanalysis(project: string, specFolder: string, held: Job | undefined): Record<string, unknown> {
  if (!held) return { project, specFolder, steps: ["analyze"] };
  const steps = ["analyze", ...held.steps.slice(held.stepIndex)];
  const forSteps = (map: Record<string, string> | undefined): Record<string, string> =>
    Object.fromEntries(steps.filter((s) => map?.[s]).map((s) => [s, map![s]!]));
  return { project, specFolder, steps, model: forSteps(held.model), effort: forSteps(held.effort) };
}
