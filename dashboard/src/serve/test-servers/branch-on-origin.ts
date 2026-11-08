import { specBranch, type BranchStatusChecker } from "../../git/branch-status.ts";

/** True only when the code checkout's cached origin answer holds the spec's
 *  branch. Not asked yet or not answerable reads as false, like every other
 *  reader of that cache. */
export function codeBranchOnOrigin(
  branchStatus: Pick<BranchStatusChecker, "peekOpenSpecBranches">,
  aideCheckout: string,
  specFolder: string,
): boolean {
  return branchStatus.peekOpenSpecBranches(aideCheckout).open?.has(specBranch(specFolder)) === true;
}
