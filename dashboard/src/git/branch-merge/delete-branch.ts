import {
  LS_REMOTE_NO_MATCH,
  lsRemoteBranch,
  type GitRunner,
} from "../branch-status.ts";
import { refuse, type RepoMergeResult } from "./result.ts";

/** Delete a spec's branch without ever merging it — the code
 *  root's own landing for a `close` step, whose whole point is that
 *  none of that work is used. Steps 1, 7 and 8 of
 *  `mergeBranchIntoDefault` alone, with no merge, gate or push in
 *  between: the origin-existence check (a branch already gone is a
 *  no-op success, exactly as it is for a merge), the origin delete and
 *  the local delete. `discarded: true` on every non-refusal outcome —
 *  `landBranch`'s per-repo success branch reads it to skip the report
 *  and install a real merge would otherwise trigger for this root. */
export async function deleteBranchOnly(
  run: GitRunner,
  root: string,
  branch: string,
): Promise<RepoMergeResult> {
  try {
    const onOrigin = await run(root, lsRemoteBranch(branch));
    if (onOrigin.code === LS_REMOTE_NO_MATCH) {
      return { root, ok: true, discarded: true };
    }
    const deleted = await run(root, [
      "push",
      "-q",
      "origin",
      "--delete",
      branch,
    ]);
    if (deleted.code !== 0) {
      const detail =
        (deleted.stderr ?? "").trim().slice(-200) || "unknown reason";
      return {
        root,
        ok: true,
        discarded: true,
        branchDeleteError: {
          key: "landing.branchDeleteFailed",
          values: { branch },
        },
        detail,
      };
    }
    // Best effort, same as `mergeBranchIntoDefault`'s own step 8: this
    // host may not even have the ref, and a cleanup must never turn a
    // successful origin delete into a failure.
    await run(root, ["branch", "-D", branch]);
    return { root, ok: true, discarded: true };
  } catch (err) {
    return {
      ...refuse(
        root,
        branch,
        { key: "landing.gitCouldNotRun" },
        err instanceof Error ? err.message : String(err),
      ),
      discarded: true,
    };
  }
}
