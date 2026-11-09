// The lock every move of a shared checkout runs under, taken the way the
// runner takes it (`checkout_lock_take`, core/scripts/lib/checkout-lock.sh):
// a directory at `<checkout>/.git/aide-run-spec-worktree.lock`, made with
// `mkdir`, holding its taker's pid; a waiter that finds that pid gone
// takes it over. The runner and the dashboard are separate processes, so
// this lock on disk is the one thing both can see. `mergeLock` serialises
// the dashboard against itself only.
//
// A move is a git command run in a shared checkout that changes its HEAD,
// index or working tree — a switch, checkout, fast-forward, reset, commit
// or rebase — with the fetch and the `worktree add` in the same section.
// The lock goes around each such section and nothing else, and is never
// taken twice in one call chain: the inner take would find its own live
// pid and wait out its whole deadline.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** `<checkout>/.git/aide-run-spec-worktree.lock` — `checkout_lock_path`. */
export function checkoutLockPath(root: string): string {
  return join(root, ".git", "aide-run-spec-worktree.lock");
}

/** The runner's own default wait (`AIDE_WORKTREE_LOCK_WAIT_SECONDS`), for a
 *  landing and Deploy, which run in the background. */
export const CHECKOUT_LOCK_WAIT_MS = 120_000;
/** For a move a person is waiting on: well inside Bun's 120 s idle limit. */
export const REQUEST_LOCK_WAIT_MS = 30_000;
/** For a best-effort catch-up on the scheduler's tick: the next tick tries
 *  again two seconds later. */
export const CATCH_UP_LOCK_WAIT_MS = 5_000;

const POLL_MS = 200;

export type UnderLock<T> =
  | { locked: true; value: T }
  | { locked: false; lock: string; owner?: number };

export interface LockWait {
  waitMs?: number;
  pollMs?: number;
  /** The pause between two polls; a test passes one that returns at once. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;

/** The pid written in the lock, or undefined for an empty or unreadable
 *  file — one a taker has not finished writing yet. */
function ownerOf(lock: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(lock, "pid"), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** The lock directory's inode, or undefined when there is none. */
function inodeOf(path: string): number | undefined {
  try {
    return statSync(path).ino;
  } catch {
    return undefined;
  }
}

/** Remove a lock whose owner is gone — the one directory `ino` names,
 *  never one another taker made in its place after the owner was read.
 *  The lock is moved aside first, which is atomic, and removed only when
 *  what was moved is that same directory; anything else is put back. */
export function takeOverGone(lock: string, ino: number | undefined): void {
  if (ino === undefined) return;
  const aside = `${lock}.gone-${process.pid}-${Date.now()}`;
  try {
    renameSync(lock, aside);
  } catch {
    return; // already gone, or taken in the meantime: the next poll sees which
  }
  if (inodeOf(aside) === ino) {
    rmSync(aside, { recursive: true, force: true });
    return;
  }
  try {
    renameSync(aside, lock);
  } catch {
    /* a lock made in the meantime stands; the moved one's owner holds on to nothing */
  }
}

/** A pid that is certainly not a process any more. `EPERM` is a process
 *  of another user, alive. A pid below 2 is never signalled at all — 1 is
 *  launchd, and the rule in `serve-helpers/signal-group.ts` holds here
 *  too — so a lock naming one is waited for, never taken over. */
function gone(pid: number | undefined): boolean {
  if (pid === undefined || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return errno(e) === "ESRCH";
  }
}

/** Run `move` holding `root`'s lock, and let go of it whether `move`
 *  returned or threw. A lock another live process holds is waited for, a
 *  poll every `pollMs`, for `waitMs` in all; a wait that runs out answers
 *  `locked: false` without running `move`.
 *
 *  A root with no `.git` directory is no shared checkout — a linked
 *  worktree, or a made-up path a test drives — and `move` runs unlocked. */
export async function withCheckoutLock<T>(
  root: string,
  move: () => Promise<T>,
  opts: LockWait = {},
): Promise<UnderLock<T>> {
  const lock = checkoutLockPath(root);
  const pollMs = opts.pollMs ?? POLL_MS;
  const polls = Math.ceil((opts.waitMs ?? CHECKOUT_LOCK_WAIT_MS) / pollMs);
  const wait = opts.wait ?? sleep;
  let owner: number | undefined;
  for (let poll = 0; ; ) {
    try {
      mkdirSync(lock);
    } catch (e) {
      const code = errno(e);
      if (code === "ENOENT" || code === "ENOTDIR") return { locked: true, value: await move() };
      if (code !== "EEXIST") throw e;
      const ino = inodeOf(lock);
      owner = ownerOf(lock);
      if (gone(owner)) {
        takeOverGone(lock, ino);
        continue;
      }
      if (poll >= polls) return { locked: false, lock, ...(owner !== undefined ? { owner } : {}) };
      poll++;
      await wait(pollMs);
      continue;
    }
    break;
  }
  try {
    writeFileSync(join(lock, "pid"), `${process.pid}\n`);
    return { locked: true, value: await move() };
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
