// Waiting out a lost race for a git lock, and retrying a push.

import type { GitRunner } from "../branch-status.ts";

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
export const GIT_LOCKED = /index\.lock|\.lock'|\.lock:|cannot lock ref|Unable to create '.*\.lock|another git process|could not lock/i;
/** Five retries, two seconds at most: a run's ref writes take well under
 *  that, and a lock that is genuinely stuck still refuses in seconds
 *  rather than holding the request open. */
export const LOCK_RETRIES = 5;
export const LOCK_WAIT_MS = 400;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export type Wait = (ms: number) => Promise<void>;

/** The same bound `aide-run-spec`'s
 *  `push_with_retry` uses (`PUSH_RETRY_WAITS`) — two extra tries,
 *  waiting longer between them than the lock retry above, since a
 *  network blip takes longer to clear than a lock held by a
 *  sibling git process on the same machine. */
const PUSH_RETRY_WAITS_MS = [1000, 2000];

interface PushRetryResult {
  ok: boolean;
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
export async function pushWithRetry(run: GitRunner, root: string, base: string, wait: Wait): Promise<PushRetryResult> {
  const refspec = `HEAD:refs/heads/${base}`;
  let pushed = await run(root, ["push", "-q", "origin", refspec]);
  if (pushed.code === 0) return { ok: true };
  const reachable = await run(root, ["ls-remote", "origin"]);
  if (reachable.code !== 0) {
    for (const ms of PUSH_RETRY_WAITS_MS) {
      await wait(ms);
      pushed = await run(root, ["push", "-q", "origin", refspec]);
      if (pushed.code === 0) return { ok: true };
    }
    return { ok: false, error: `cannot reach origin — ${(pushed.stderr ?? "").trim().slice(-200)}` };
  }
  // Reachable, still rejected: base moved on origin under this landing.
  // Not settled here with `pull --rebase` any more — a rebase of a
  // landing's merge commits failed before it started once (364,
  // 2026-09-03) and left the checkout ahead of origin, which then
  // refused every later landing in that root. The caller drops the
  // local merge and merges again onto the base that moved.
  return { ok: false, moved: true, error: (pushed.stderr ?? "").trim().slice(-200) };
}
