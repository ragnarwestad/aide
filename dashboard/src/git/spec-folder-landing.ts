// Landing ONE spec's own folder from its branch, and nothing else on it.
//
// A project whose specs live inside its code repo has one branch for
// both, and a round's `analyze` (or a `reopen`, `close`) must
// bring the spec's files to the default branch without the code an
// earlier `implement` left beside them: code reaches the default branch
// through `archive` alone. So this copies what the branch changed under
// the spec's own paths onto base as one commit, and leaves every other
// path as base has it. The branch stays open for the next step — whose
// run merges base in before it starts, so the two copies never diverge
// — unless the landing is a `close`, where it is deleted.

import {
  LANDING_RETRIES, mergeWorktreePath, pushRefusal, pushWithRetry, refuse, sleep, type RepoMergeResult, type Wait,
} from "./branch-merge/index.ts";
import { withCheckoutLock } from "./checkout-lock/index.ts";
import { LS_REMOTE_NO_MATCH, lsRemoteBranch } from "./branch-status.ts";
import { type GitRunner } from "./process/index.ts";
import { prepareMergeWorktree, WORKTREE_TIMEOUT_MS } from "./branch-merge/worktree.ts";
import type { MergeHooks } from "./merge-hooks.ts";

export interface SpecFolderLanding {
  /** Repo-relative paths the spec may occupy: its active folder and its
   *  `archive/` twin, where both Archive and Close move it. */
  paths: string[];
  /** Commit subject for the copy on base. */
  message: string;
  /** Delete the branch once its spec files are on base (`close`). */
  deleteBranch: boolean;
  hooks?: MergeHooks;
}

export async function landSpecFolderOnly(
  run: GitRunner,
  root: string,
  branch: string,
  base: string,
  spec: SpecFolderLanding,
  wait: Wait = sleep,
): Promise<RepoMergeResult> {
  // Set once the worktree's path is chosen, so `finally` removes it.
  const at = { work: "" };
  try {
    const onOrigin = await run(root, lsRemoteBranch(branch));
    if (onOrigin.code === LS_REMOTE_NO_MATCH) {
      return { ...refuse(root, branch, { key: "landing.nothingLeftToMerge" }), reason: "gone" };
    }
    const opened = await openLandingWorktree(run, root, branch, base, at, wait);
    if (opened) return opened;
    const published = await publishSpecCopy(run, { root, branch, base, work: at.work }, spec, wait);
    if (published) return published;
    return await finishLanding(run, root, branch, base, spec, wait);
  } catch (err) {
    return refuse(root, branch, { key: "landing.gitCouldNotRun" }, err instanceof Error ? err.message : String(err));
  } finally {
    if (at.work) {
      await run(root, ["worktree", "remove", "--force", at.work], WORKTREE_TIMEOUT_MS);
      await run(root, ["worktree", "prune"]);
    }
  }
}

/** Fetch base and the branch and add a detached worktree on base at
 *  `at.work`, or the refusal when that cannot be done. The fetch and the
 *  worktree add move the shared checkout, under its lock, as a run's own
 *  do. */
async function openLandingWorktree(
  run: GitRunner,
  root: string,
  branch: string,
  base: string,
  at: { work: string },
  wait: Wait,
): Promise<RepoMergeResult | null> {
  const prepared = await withCheckoutLock(root, async (): Promise<RepoMergeResult | null> => {
    await run(root, ["fetch", "-q", "origin", base, branch]);
    at.work = mergeWorktreePath(root, branch);
    await prepareMergeWorktree(run, root, at.work);
    const added = await run(root, ["worktree", "add", "--detach", "-q", at.work, `origin/${base}`], WORKTREE_TIMEOUT_MS);
    if (added.code !== 0) {
      await run(root, ["worktree", "prune"]);
      return refuse(root, branch, { key: "landing.cannotSwitch", values: { base } }, (added.stderr ?? "").trim() || undefined);
    }
    return null;
  }, { wait });
  if (!prepared.locked) {
    return refuse(root, branch, { key: "landing.checkoutLockTimedOut", values: { lock: prepared.lock } });
  }
  return prepared.value;
}

/** Stage in `work` what the branch at `ref` changed under the spec's
 *  paths since it left base. `--no-renames`, so a folder move reads as
 *  the deletes and adds it is, and each is replayed as such. */
async function stageSpecChanges(run: GitRunner, work: string, ref: string, paths: string[]): Promise<void> {
  const diff = await run(work, ["diff", "--name-status", "--no-renames", `HEAD...${ref}`, "--", ...paths]);
  for (const line of diff.stdout.split("\n").filter(Boolean)) {
    const [status, path] = line.split("\t");
    if (!path) continue;
    if (status === "D") await run(work, ["rm", "-q", "--ignore-unmatch", "--", path]);
    else await run(work, ["checkout", ref, "--", path]);
  }
}

/** Commit the spec's changes on base in `work` and push them, rebuilding
 *  on a base that moved meanwhile. `null` once they are on origin, or
 *  when there was nothing to copy; the refusal otherwise. */
async function publishSpecCopy(
  run: GitRunner,
  where: { root: string; branch: string; base: string; work: string },
  spec: SpecFolderLanding,
  wait: Wait,
): Promise<RepoMergeResult | null> {
  const { root, branch, base, work } = where;
  const ref = `refs/remotes/origin/${branch}`;
  for (let attempt = 0; ; attempt++) {
    await stageSpecChanges(run, work, ref, spec.paths);
    const staged = await run(work, ["diff", "--cached", "--quiet"]);
    if (staged.code === 0) return null;
    await run(work, ["commit", "-q", "-m", spec.message]);
    const published = await withCheckoutLock(root, () => pushWithRetry(run, work, base, wait), { wait });
    if (!published.locked) {
      return refuse(root, branch, { key: "landing.checkoutLockTimedOut", values: { lock: published.lock } });
    }
    const pushed = published.value;
    if (pushed.ok) return null;
    if (!pushed.moved) {
      return pushRefusal(root, branch, base, pushed);
    }
    if (attempt >= LANDING_RETRIES.baseMovedRebuilds) return refuse(root, branch, { key: "landing.baseMovedTwice", values: { base } }, pushed.error);
    await run(work, ["fetch", "--quiet", "origin", base]);
    await run(work, ["reset", "-q", "--hard", `origin/${base}`]);
  }
}

/** After the copy is on base: the shared checkout catches up, and a
 *  `close` deletes the branch. */
async function finishLanding(
  run: GitRunner,
  root: string,
  branch: string,
  base: string,
  spec: SpecFolderLanding,
  wait: Wait,
): Promise<RepoMergeResult> {
  if (spec.deleteBranch) await spec.hooks?.beforeCheckoutMoves?.({});
  // The shared checkout catches up, as after any landing, under its
  // lock; not fatal, and tried once.
  await withCheckoutLock(root, async () => {
    await run(root, ["fetch", "-q", "origin", base]);
    await run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
  }, { wait });
  // Nothing of the code landed: the caller installs and reports nothing.
  if (!spec.deleteBranch) return { root, ok: true, discarded: true };
  const deleted = await run(root, ["push", "-q", "origin", "--delete", branch]);
  if (deleted.code !== 0) {
    return {
      root,
      ok: true,
      discarded: true,
      branchDeleteError: { key: "landing.branchDeleteFailed", values: { branch } },
      detail: (deleted.stderr ?? "").trim().slice(-200) || "unknown reason",
    };
  }
  await run(root, ["branch", "-D", branch]);
  return { root, ok: true, discarded: true };
}
