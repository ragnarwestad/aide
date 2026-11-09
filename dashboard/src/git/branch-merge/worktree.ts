import { existsSync, lstatSync, mkdtempSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../process/index.ts";

export const WORKTREE_TIMEOUT_MS = 60_000;

export async function prepareMergeWorktree(run: GitRunner, root: string, work: string): Promise<void> {
  await run(root, ["worktree", "remove", "--force", work], WORKTREE_TIMEOUT_MS);
  // A failed worktree add can leave files without a .git entry. Git
  // cannot remove that directory; preserve its contents before retrying.
  if (lstatSync(work, { throwIfNoEntry: false })?.isDirectory() && !existsSync(join(work, ".git"))) {
    const backup = mkdtempSync(`${work}.incomplete-`);
    renameSync(work, backup);
  }
}
