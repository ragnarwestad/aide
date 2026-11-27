// A branch built on another branch that is still waiting in the Merge
// queue. Merge puts a branch on the default branch as one new commit, so
// the waiting branch's own commits never become the default branch's, and
// a branch built on them would merge them a second time and stop on a
// conflict. Merge refuses such a branch before it queues.

import type { GitRunner } from "../../../git/process/index.ts";
import { lsRemoteBranch } from "../../../git/branch-status.ts";
import { REQUEST_LOCK_WAIT_MS, withCheckoutLock } from "../../../git/checkout-lock/index.ts";

/** The tip origin names for `branch`, or nothing when it cannot say. */
async function tipOf(run: GitRunner, root: string, branch: string): Promise<string | undefined> {
  const found = await run(root, lsRemoteBranch(branch));
  return found.code === 0 ? found.stdout.split(/\s/)[0] || undefined : undefined;
}

/** The first of `waiting` whose tip `branch` contains and the default
 *  branch does not, or nothing. A question git cannot answer lets the
 *  branch through: the merge itself still stops on a real conflict. */
export async function stackedOn(
  run: GitRunner,
  root: string,
  branch: string,
  base: string,
  waiting: readonly string[],
): Promise<string | undefined> {
  const others = waiting.filter((other) => other !== branch);
  if (others.length === 0) return undefined;
  const fetched = await withCheckoutLock(
    root,
    () => run(root, ["fetch", "--quiet", "--no-write-fetch-head", "origin", `refs/heads/${branch}`, `refs/heads/${base}`]),
    { waitMs: REQUEST_LOCK_WAIT_MS },
  );
  if (!fetched.locked || fetched.value.code !== 0) return undefined;
  const [tip, baseTip] = [await tipOf(run, root, branch), await tipOf(run, root, base)];
  if (!tip || !baseTip) return undefined;
  const contains = async (ancestor: string, of: string) => (await run(root, ["merge-base", "--is-ancestor", ancestor, of])).code === 0;
  for (const other of others) {
    const otherTip = await tipOf(run, root, other);
    if (otherTip && (await contains(otherTip, tip)) && !(await contains(otherTip, baseTip))) return other;
  }
  return undefined;
}
