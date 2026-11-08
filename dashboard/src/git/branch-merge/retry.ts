// Waiting out a lost race for a git lock, and retrying a push.

import type { GitRunner } from "../branch-status.ts";
import {
  gitError,
  gitErrorDetail,
  type GitError,
} from "../../format/git-error.ts";

/** git's own words when another process is holding the index. A run
 *  starting in the same second pulls the same checkout as a courtesy,
 *  and whoever gets there second sees this — not a divergence, just a
 *  lost race, and it refused three merges on 2026-08-18 as though the
 *  base had moved. */
/** Every lock git can lose a race for, not only the index's: a run's
 *  own `aide-run-spec` writes refs in this same checkout at its start
 *  and its end (fetch --force, branch -f/-D, update-ref -d, worktree
 *  prune), and a landing in the same second met `packed-refs.lock` and
 *  `cannot lock ref` — refused as "cannot fast-forward", with git's own
 *  words thrown away (2026-09-03, twice in a row). */
export const GIT_LOCKED =
  /index\.lock|\.lock'|\.lock:|cannot lock ref|Unable to create '.*\.lock|another git process|could not lock/i;
/** Five retries, two seconds at most: a run's ref writes take well under
 *  that, and a lock that is genuinely stuck still refuses in seconds
 *  rather than holding the request open. */
export const LOCK_RETRIES = 5;
export const LOCK_WAIT_MS = 400;

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
export type Wait = (ms: number) => Promise<void>;

/** The same bound `aide-run-spec`'s
 *  `push_with_retry` uses (`PUSH_RETRY_WAITS`) — two extra tries,
 *  waiting longer between them than the lock retry above, since a
 *  network blip takes longer to clear than a lock held by a
 *  sibling git process on the same machine. */
const PUSH_RETRY_WAITS_MS = [1000];
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
): Promise<PushRetryResult> {
  const refspec = `HEAD:refs/heads/${base}`;
  const push = () =>
    run(root, ["push", "-q", "origin", refspec], PUSH_TIMEOUT_MS);
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
  if (reachable.code !== 0) {
    for (const ms of PUSH_RETRY_WAITS_MS) {
      await wait(ms);
      pushed = await push();
      if (pushed.code === 0) return { ok: true };
    }
    const said = (pushed.stderr ?? "").trim() || (reachable.stderr ?? "");
    return { ok: false, cause: gitError(said), error: gitErrorDetail(said) };
  }
  // Reachable, and origin itself turned the push down (`[remote rejected]`:
  // a rule, a hook, an error at GitHub): nothing moved, so merging again
  // would only be refused again. git's own words say why.
  const said = pushed.stderr ?? "";
  if (!BASE_MOVED.test(said))
    return { ok: false, cause: gitError(said), error: gitErrorDetail(said) };
  // Reachable, still rejected: base moved on origin under this landing.
  // Not settled here with `pull --rebase` any more — a rebase of a
  // landing's merge commits failed before it started once (364,
  // 2026-09-03) and left the checkout ahead of origin, which then
  // refused every later landing in that root. The caller drops the
  // local merge and merges again onto the base that moved.
  return { ok: false, moved: true, error: gitErrorDetail(pushed.stderr ?? "") };
}
