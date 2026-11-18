// The copy of a landed branch in the checkout a session pushed it from.
// A Land merges on the board's own checkout and deletes the branch on
// origin; the session's local branch, and the worktree it was made in,
// stay behind unless something removes them. This does, once the branch's
// content is on the default branch, and never anything holding work of
// its own: a worktree with changes or untracked files is kept, and so is
// the branch it holds.

import { contentLandedIn } from "../branch-status.ts";
import type { GitRunner } from "../process/index.ts";

/** What was removed from `checkout`, and what was kept and why. */
export interface LandedCopyCleanup {
  removed: string[];
  kept: string[];
}

export async function removeLandedCopy(
  run: GitRunner,
  checkout: string,
  branch: string,
  base: string,
): Promise<LandedCopyCleanup> {
  const out: LandedCopyCleanup = { removed: [], kept: [] };
  const tip = await run(checkout, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (tip.code !== 0) return out;
  await run(checkout, ["fetch", "-q", "origin", base]);
  if (!(await contentLandedIn(run, checkout, tip.stdout.trim(), `refs/remotes/origin/${base}`))) {
    out.kept.push(`branch ${branch}: it has work that is not on ${base}`);
    return out;
  }
  const list = await run(checkout, ["worktree", "list", "--porcelain"]);
  const entries = list.stdout.split("\n\n").map((entry) => entry.split("\n"));
  const main = entries[0]?.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
  for (const lines of entries) {
    if (!lines.includes(`branch refs/heads/${branch}`)) continue;
    const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!path) continue;
    if (path === main) {
      out.kept.push(`branch ${branch}: it is checked out in ${path}`);
      return out;
    }
    const removed = await run(checkout, ["worktree", "remove", path]);
    if (removed.code !== 0) {
      out.kept.push(`worktree ${path}: ${(removed.stderr ?? "").trim().split("\n")[0] || "git would not remove it"}`);
      return out;
    }
    out.removed.push(`worktree ${path}`);
  }
  const deleted = await run(checkout, ["branch", "-D", branch]);
  if (deleted.code === 0) out.removed.push(`branch ${branch}`);
  else out.kept.push(`branch ${branch}: ${(deleted.stderr ?? "").trim().split("\n")[0]}`);
  return out;
}
