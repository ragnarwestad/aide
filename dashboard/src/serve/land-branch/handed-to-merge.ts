// What `landBranch` hands `mergeBranchIntoDefault` for one repo: the
// test gate (code roots only), the create finalizer (a `create` landing
// only) and the hook that runs before the shared checkout moves.
//
// The hook is where the page's view is settled: the checkout's
// fast-forward makes a landed folder visible (the watcher rescans on
// it), and two things used to be settled only when the whole landing
// was over, seconds later — a create job kept its provisional key while
// the scan already showed the numbered folder (two rows for one spec),
// and the cached open-branch set still named the branch (the archived
// row read "still on origin — re-run archive").

import { resolve, sep } from "node:path";

import type { CreateFinalizer } from "../../git/create-finalizer.ts";
import type { LandingGate } from "../../git/branch-merge.ts";
import type { MergeHooks } from "../../git/merge-hooks.ts";
import type { Job } from "../../queue/queue.ts";
import type { LandContext, Landing } from "./types.ts";

/** The roots the open-branch cache is keyed by that this repo holds:
 *  the cache is asked per spec root — the project dir, and the specs
 *  path, which for a specs repo with a project subfolder sits BELOW the
 *  repo root the merge is about — so a forget under the repo root alone
 *  never reached the cached answer the archived row reads. */
export function cacheRootsWithin(
  ctx: Pick<LandContext, "machineryProjectDir" | "machinerySpecsRoot">,
  project: string,
  root: string,
): string[] {
  const top = resolve(root);
  const inside = (d: string): boolean => resolve(d) === top || resolve(d).startsWith(top + sep);
  const candidates = [root, ctx.machineryProjectDir(project), ctx.machinerySpecsRoot(project)].filter(
    (d): d is string => !!d,
  );
  return [...new Set(candidates.filter(inside))];
}

/** A branch whose delete failed IS still on origin: put it back under
 *  the same roots it was forgotten under before the checkout moved. */
export function rememberUnderRoots(
  ctx: Pick<LandContext, "machineryProjectDir" | "machinerySpecsRoot" | "branchStatus">,
  project: string,
  root: string,
  branch: string,
): void {
  for (const r of cacheRootsWithin(ctx, project, root)) ctx.branchStatus.rememberOpenSpecBranch(r, branch);
}

export function handedToMerge(
  ctx: LandContext,
  job: Job,
  what: Pick<Landing, "step">,
  root: string,
  branch: string,
  codeRoots: Pick<Set<string>, "has">,
): { gate?: LandingGate; finalizeCreate?: CreateFinalizer; hooks: MergeHooks } {
  const gate = codeRoots.has(root) && ctx.landingGate
    ? (r: string) => ctx.landingGate!(r, job, branch)
    : undefined;
  // Spec 453: a `create` job's folder exists only under its literal
  // provisional key until this runs, under the SAME per-repo lock the
  // merge takes — the one place two landings for this repo cannot both
  // be renaming a folder at once.
  const specsRootAbs = what.step === "create" ? ctx.machinerySpecsRoot(job.project) : undefined;
  const finalizeCreate = ctx.finalizeCreateSpec && specsRootAbs
    ? (work: string) => ctx.finalizeCreateSpec!(work, root, specsRootAbs, job.specFolder)
    : undefined;
  const hooks: MergeHooks = {
    beforeCheckoutMoves: (info) => {
      if (info.assignedSpecFolder) {
        // The pendingModels rename runs BEFORE the job's own specFolder
        // update: a crash between the two then leaves the job on its
        // ORIGINAL, still-correct provisional key, so a pick already
        // banked under it stays reachable rather than becoming orphaned
        // under a real folder the job itself has not moved to yet
        // (spec 465).
        ctx.queue.renamePendingModel(job.project, job.specFolder, info.assignedSpecFolder);
        ctx.queue.update(job.id, { specFolder: info.assignedSpecFolder });
      }
      // The branch is merged on origin by now; its delete is the very
      // next thing. A delete that then fails is reported through
      // `branchDeleteError` on the job, and the landing's own fresh
      // origin check repopulates this set with the truth.
      for (const r of cacheRootsWithin(ctx, job.project, root)) ctx.branchStatus.forgetOpenSpecBranch(r, branch);
    },
  };
  return { gate, finalizeCreate, hooks };
}
