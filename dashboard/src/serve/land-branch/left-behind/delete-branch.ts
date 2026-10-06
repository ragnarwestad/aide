// Delete branch: an archived spec whose landing merged its branch but
// could not delete it on origin has only this cleanup left, and the
// row's button asks for it. Origin is asked fresh, and a branch that is
// not merged in every root that holds it is deleted nowhere. The one
// cached answer trusted is a merged pull request: it never changes, so
// it only has to match the tip origin has just given.

import { LS_REMOTE_NO_MATCH, lsRemoteBranch, specBranch } from "../../../git/branch-status.ts";
import { deleteBranchOnly } from "../../../git/branch-merge.ts";
import { mergedPullRequest, specRoots } from "../../spec-lookup.ts";
import type { LandContext } from "../types.ts";

export type DeleteLeftBehindContext = Pick<
  LandContext,
  "machineryProjectDir" | "machinerySpecsRoot" | "branchStatus" | "gitRun" | "mergeLock" | "specsRoot" | "codeLanding"
  | "pullRequests"
>;

export type DeleteLeftBehindResult = { ok: true } | { ok: false; error: string };

export async function deleteLeftBehindBranch(
  ctx: DeleteLeftBehindContext,
  project: string,
  folder: string,
): Promise<DeleteLeftBehindResult> {
  const branch = specBranch(folder);
  // Asked per root with the branch's own `ls-remote`, not through the
  // open set: an unanswerable ask there would blank the cached set, and
  // the row would lose its note although nothing was deleted.
  const holding: { root: string; tip: string }[] = [];
  for (const root of specRoots(ctx, project)) {
    const asked = await ctx.gitRun(root, lsRemoteBranch(branch)).then((r) => r, () => null);
    const code = asked?.code ?? null;
    if (code === 0) holding.push({ root, tip: asked!.stdout.trim().split(/\s/)[0]! });
    else if (code === LS_REMOTE_NO_MATCH) ctx.branchStatus.forgetOpenSpecBranch(root, branch);
    else return { ok: false, error: `origin could not be asked about ${branch}. — Press Delete branch again.` };
  }
  // Every root before any delete, so a spec merged in one repository and
  // not in the other loses nothing.
  for (const { root, tip } of holding) {
    if (await ctx.branchStatus.isMerged(root, branch, true)) continue;
    // A squash merge never makes git call the branch merged. Origin's tip,
    // asked just now, must still be the head the pull request merged.
    if (mergedPullRequest(ctx, project, folder, root)?.headSha === tip) continue;
    return {
      ok: false,
      error: `${branch} has work that is not on the default branch, so nothing was deleted. — Run archive again to land it.`,
    };
  }
  // A specs root inside the code checkout is the same repository: one
  // delete for both, or the second finds the branch gone and fails.
  const byRepo = new Map<string, string[]>();
  for (const { root } of holding) {
    const top = await ctx.specsRoot(root);
    byRepo.set(top, [...(byRepo.get(top) ?? []), root]);
  }
  for (const [top, roots] of byRepo) {
    const result = await ctx.mergeLock.run(top, () => deleteBranchOnly(ctx.gitRun, top, branch));
    if (!result.ok || result.branchDeleteError) {
      console.error(`queue: deleting ${branch} in ${top} failed — ${result.detail ?? "unknown reason"}`);
      return { ok: false, error: `${branch} could not be deleted on origin. — Press Delete branch again.` };
    }
    // Under exactly the paths the row peeks, so its next draw has no note.
    for (const root of roots) {
      ctx.branchStatus.forgetOpenSpecBranch(root, branch);
      ctx.branchStatus.invalidate(root, branch);
    }
  }
  ctx.pullRequests?.delete(`${project}/${folder}`);
  return { ok: true };
}
