import type { GitRunner } from "../branch-status.ts";
import { refuse, type RepoMergeResult } from "./result.ts";
import { GIT_LOCKED, LOCK_RETRIES, LOCK_WAIT_MS, sleep, type Wait } from "./retry.ts";

/** Bring `base` in `root` level with what origin has — no feature
 *  branch involved. This is steps 2-3 of `mergeBranchIntoDefault`
 *  alone: the deploy button's whole job is a checkout that fell behind
 *  because a merge landed somewhere other than this dashboard's own
 *  Merge button, so there is nothing to merge IN, only to fast-forward.
 *
 *  Refuses rather than guesses when the checkout is not standing on
 *  `base`: `commitsBehindOrigin` only ever reports a real count for a
 *  checkout it found there, so a caller reaching here on the strength of
 *  that count is refused, cleanly, if the checkout moved on since. */
export async function fastForwardToOrigin(
  run: GitRunner,
  root: string,
  base: string,
  wait: Wait = sleep,
): Promise<RepoMergeResult> {
  try {
    const current = await run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const on = current.stdout.trim();
    if (current.code !== 0 || on !== base) {
      return refuse(
        root,
        base,
        { key: "landing.deployWrongBranch", values: { on: on || "an unknown branch", base } },
      );
    }
    await run(root, ["fetch", "--quiet", "origin", base]);
    let pulled = await run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
    for (let n = 0; pulled.code !== 0 && GIT_LOCKED.test(pulled.stderr ?? "") && n < LOCK_RETRIES; n++) {
      await wait(LOCK_WAIT_MS);
      pulled = await run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
    }
    if (pulled.code !== 0) {
      return refuse(root, base, { key: "landing.deployCannotFastForward" });
    }
    return { root, ok: true };
  } catch (err) {
    return refuse(
      root,
      base,
      { key: "landing.gitCouldNotRun" },
      err instanceof Error ? err.message : String(err),
    );
  }
}
