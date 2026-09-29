// A spec file as the spec's own open branch holds it: the copy a Save
// writes to, so the copy the page has to draw.

import { commitTimeOf, readStatusFromFetchedBranch, resolveOpenBranchTarget } from "../../git/branch-file.ts";
import type { SpecViewsContext } from "./";

export interface BranchCopy {
  text: string;
  /** The commit that last touched the file on the branch. */
  sha: string;
  /** When that commit was authored. Absent when git cannot say, and the
   *  page then draws no stamp rather than a wrong one. */
  at?: string;
}

/** `file` off the branch of `specFolder`, as of its last fetch — the page
 *  never waits on origin. `null` when the spec has no open branch or the
 *  branch has no such file, and the caller reads the disk as it always did.
 *
 *  `dir` is the spec's folder in the checkout the caller reads through. */
export async function readBranchCopy(
  ctx: Pick<SpecViewsContext, "specsRoot" | "branchStatus" | "gitRun">,
  dir: string,
  specFolder: string,
  file: string,
): Promise<BranchCopy | null> {
  const target = await resolveOpenBranchTarget(ctx, dir, specFolder, file, false);
  const read = target ? await readStatusFromFetchedBranch(ctx.gitRun, target.root, target.branch, target.relPath) : null;
  if (!target || !read) return null;
  return { ...read, at: (await commitTimeOf(ctx.gitRun, target.root, read.sha)) ?? undefined };
}
