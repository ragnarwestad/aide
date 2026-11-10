// Waiting out a lost race for a git lock, and retrying a push.

import type { GitRunner } from "../process/index.ts";
import { gitError, gitErrorDetail, type GitError } from "../../format/git-error.ts";
import type { RepoMergeResult } from "./result.ts";

/** Every lock git can lose a race for, not only the index's. Read by
 *  one place alone: the merge in a landing's own worktree
 *  (`merge.ts`), which shares refs with the checkout it was cut from
 *  but not its index or HEAD, and so does not run under the checkout's
 *  lock. Every move of a shared checkout runs under that lock
 *  (`checkout-lock/`) and is tried once. */
export const GIT_LOCKED = /index\.lock|\.lock'|\.lock:|cannot lock ref|Unable to create '.*\.lock|another git process|could not lock/i;
/** Every retry a landing makes and the waits between them: the one place
 *  their bounds are written. The late retry, which queues the step again,
 *  spends the step's own retry allowance (`queue/runner/retry.ts`) and is
 *  no bound of the landing's. */
export const LANDING_RETRIES = {
  /** A merge in the landing's own worktree that lost a git lock: five
   *  retries, two seconds at most. A run's ref writes take well under
   *  that, and a lock that is genuinely stuck still refuses in seconds. */
  lockRetries: 5,
  lockWaitMs: 400,
  /** One more push per wait after an unreachable origin — the same bound
   *  `aide-run-spec`'s `push_with_retry` uses (`PUSH_RETRY_WAITS`). Longer
   *  than the lock wait, since a network blip takes longer to clear than
   *  a lock held by a sibling git process on the same machine. */
  pushWaitsMs: [1000],
  /** Main moved on origin under the landing: the merge is rebuilt on the
   *  new base this often, and a further move is refused. */
  baseMovedRebuilds: 1,
  /** The whole per-root operation repeated after a refusal: a folder
   *  landed alone twice, a number that could not be assigned once, any
   *  other refusal not at all. A red suite is never repeated here. */
  repeats: { specFolderOnly: 2, createNumber: 1, other: 0 },
  /** The wait before repeat n (from 0) is `repeatWaitMs * (n + 1)`. */
  repeatWaitMs: 700,
  /** A red suite on the merge is run this many more times, unless it
   *  timed out. */
  gateReruns: 1,
  /** `archive`'s origin check merges a root that still holds the branch
   *  this many more times before it calls it unlanded. */
  originRechecks: 1,
} as const;

/** How often the per-root operation is repeated after `first`. */
export function landingRepeats(first: RepoMergeResult, specFolderOnly: boolean): number {
  if (first.ok || first.reason === "tests-red") return 0;
  if (specFolderOnly) return LANDING_RETRIES.repeats.specFolderOnly;
  return first.reason === "create-number" ? LANDING_RETRIES.repeats.createNumber : LANDING_RETRIES.repeats.other;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export type Wait = (ms: number) => Promise<void>;

/** A push and the question to origin that follows a failed one get a
 *  minute, not the runner's four-second default: a push to GitHub over
 *  SSH takes longer than that, and a killed one says nothing at all. */
const PUSH_TIMEOUT_MS = 60_000;
/** git's own line for a push refused because origin's branch is ahead:
 *  `! [rejected] main -> main (fetch first)` or `(non-fast-forward)`.
 *  `[remote rejected]` is origin refusing for a reason of its own. */
const BASE_MOVED = /\[rejected\]|non-fast-forward|\(fetch first\)/;

interface PushRetryResult {
  ok: boolean;
  /** What git said, sorted (`src/format/git-error.ts`): the board's
   *  sentence is made from it. */
  cause?: GitError;
  /** git's own lines, whole, for the (?) detail. */
  error?: string;
  /** Origin answered and still refused: `base` moved under the landing. */
  moved?: boolean;
}

/** One push, with its own recovery — the
 *  landing's side of the same rule `aide-run-spec`'s `push_with_retry`
 *  follows. `root` here is the landing's own worktree, whose HEAD is
 *  DETACHED at the merge it just made — so the refspec is explicit.
 *  `push origin <base>` would push the shared checkout's own local
 *  branch of that name, which is the one thing on the machine that does
 *  NOT have the merge in it. The push failing means base moved on
 *  origin since the worktree was cut. Unreachable origin is retried blind; a reachable
 *  origin that still rejected the push means base moved under us, which
 *  `pull --rebase` can settle on its own — unless the rebase
 *  itself conflicts, which is a person's call and never this
 *  function's. */
export async function pushWithRetry(
  run: GitRunner,
  root: string,
  base: string,
  wait: Wait,
  retryAllowed = true,
): Promise<PushRetryResult> {
  const refspec = `HEAD:refs/heads/${base}`;
  const push = () => run(root, ["push", "-q", "origin", refspec], PUSH_TIMEOUT_MS);
  let pushed = await push();
  if (pushed.code === 0) return { ok: true };
  const firstCause = gitError(pushed.stderr ?? "");
  if (["auth", "no-write", "https-auth"].includes(firstCause.kind))
    return {
      ok: false,
      cause: firstCause,
      error: gitErrorDetail(pushed.stderr ?? ""),
    };
  // An SSH key GitHub does not take fails this question too, so git's own
  // words, not the failed answer, say why.
  const reachable = await run(root, ["ls-remote", "origin"], PUSH_TIMEOUT_MS);
  if (reachable.code === 0 && BASE_MOVED.test(pushed.stderr ?? "")) {
    // The caller spends the one remaining attempt by rebuilding the merge
    // on the new base. That retry and this helper share the same bound.
    return {
      ok: false,
      moved: true,
      error: gitErrorDetail(pushed.stderr ?? ""),
    };
  }
  const transient = ["github", "network", "other", "none"].includes(
    firstCause.kind,
  );
  if (retryAllowed && (reachable.code !== 0 || transient)) {
    for (const ms of LANDING_RETRIES.pushWaitsMs) {
      await wait(ms);
      pushed = await push();
      if (pushed.code === 0) return { ok: true };
    }
    const said = (pushed.stderr ?? "").trim() || (reachable.stderr ?? "");
    return { ok: false, cause: gitError(said), error: gitErrorDetail(said) };
  }
  // The second merge attempt has already spent the retry allowance. A
  // network failure here is final, so the same press never reaches a third
  // push. A reachable rule or hook refusal is likewise final.
  const said = pushed.stderr ?? "";
  return { ok: false, cause: gitError(said), error: gitErrorDetail(said) };
}
