import type { GitRunner } from "../process/index.ts";
import { withCheckoutLock } from "../checkout-lock/index.ts";
import { refuse, type RepoMergeResult } from "./result.ts";
import { sleep, type Wait } from "./retry.ts";

/** Bring `base` in `root` level with what origin has — no feature
 *  branch involved. This is steps 2-3 of `mergeBranchIntoDefault`
 *  alone: the deploy button's whole job is a checkout that fell behind
 *  because a merge landed somewhere other than this dashboard's own
 *  Merge button, so there is nothing to merge IN, only to fast-forward.
 *
 *  Refuses rather than guesses when the checkout is not standing on
 *  `base`: `commitsBehindOrigin` only ever reports a real count for a
 *  checkout it found there, so a caller reaching here on the strength of
 *  that count is refused, cleanly, if the checkout moved on since.
 *
 *  The check, the fetch and the fast-forward run under the checkout's
 *  lock, which a run takes for its own pull; `wait` paces the polls for
 *  it. */
export async function fastForwardToOrigin(
  run: GitRunner,
  root: string,
  base: string,
  wait: Wait = sleep,
): Promise<RepoMergeResult> {
  try {
    const moved = await withCheckoutLock(root, async (): Promise<RepoMergeResult> => {
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
      const pulled = await run(root, ["merge", "-q", "--ff-only", `origin/${base}`]);
      if (pulled.code !== 0) {
        return refuse(root, base, { key: "landing.deployCannotFastForward" });
      }
      return { root, ok: true };
    }, { wait });
    if (!moved.locked) return refuse(root, base, { key: "landing.checkoutLockTimedOut", values: { lock: moved.lock } });
    return moved.value;
  } catch (err) {
    return refuse(
      root,
      base,
      { key: "landing.gitCouldNotRun" },
      err instanceof Error ? err.message : String(err),
    );
  }
}
