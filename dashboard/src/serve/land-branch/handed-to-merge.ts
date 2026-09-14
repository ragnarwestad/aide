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

import type { CreateFinalizer } from "../../git/create-finalizer.ts";
import type { LandingGate } from "../../git/branch-merge.ts";
import type { MergeHooks } from "../../git/merge-hooks.ts";
import type { Job } from "../../queue/queue.ts";
import type { LandContext, Landing } from "./types.ts";

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
      if (info.assignedSpecFolder) ctx.queue.update(job.id, { specFolder: info.assignedSpecFolder });
      // The branch is merged on origin by now; its delete is the very
      // next thing. A delete that then fails is reported through
      // `branchDeleteError` on the job, and the landing's own fresh
      // origin check repopulates this set with the truth.
      ctx.branchStatus.forgetOpenSpecBranch(root, branch);
    },
  };
  return { gate, finalizeCreate, hooks };
}
