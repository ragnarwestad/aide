// A shared checkout whose lock another live process holds, for the tests
// that check a function waits for it before it moves the checkout. Only
// the `.git` directory is real: the git runner the function is given is
// a fake, and asks `held.ours()` at each command whether the dashboard
// held the lock while it ran.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutLockPath } from "../../src/git/checkout-lock/index.ts";
import type { GitRunner } from "../../src/git/process/index.ts";

export interface HeldLock {
  root: string;
  lock: string;
  /** Whether the lock stands with THIS process's pid in it. */
  ours(): boolean;
  /** Whether it stands at all, whoever holds it. */
  held(): boolean;
  /** The other process lets go after `ms`. */
  releaseAfter(ms: number): void;
  cleanup(): void;
}

/** `root` (a new directory with a `.git`, or `root` itself when given)
 *  with its lock held by the test's parent process — a process that is
 *  alive and is not this one. */
export function heldLock(root?: string): HeldLock {
  const dir = root ?? mkdtempSync(join(tmpdir(), "aide-held-lock-"));
  mkdirSync(join(dir, ".git"), { recursive: true });
  const lock = checkoutLockPath(dir);
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), `${process.ppid}\n`);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const pid = (): string => {
    try {
      return readFileSync(join(lock, "pid"), "utf8").trim();
    } catch {
      return "";
    }
  };
  return {
    root: dir,
    lock,
    ours: () => pid() === String(process.pid),
    held: () => existsSync(lock),
    releaseAfter: (ms) => {
      timers.push(setTimeout(() => rmSync(lock, { recursive: true, force: true }), ms));
    },
    cleanup: () => {
      for (const t of timers) clearTimeout(t);
      if (!root) rmSync(dir, { recursive: true, force: true });
      else rmSync(lock, { recursive: true, force: true });
    },
  };
}

/** Wraps a git runner so every call records whether the dashboard held
 *  the lock when it ran. */
export function watchLock(held: HeldLock, run: GitRunner) {
  const seen: { args: string; dir: string; ours: boolean }[] = [];
  const wrapped: GitRunner = async (dir, args, timeoutMs, env) => {
    seen.push({ dir, args: args.join(" "), ours: held.ours() });
    return run(dir, args, timeoutMs, env);
  };
  /** The calls in `held.root` starting with one of `prefixes`. */
  const moves = (...prefixes: string[]) =>
    seen.filter((c) => c.dir === held.root && prefixes.some((p) => c.args.startsWith(p)));
  return { run: wrapped, seen, moves };
}
