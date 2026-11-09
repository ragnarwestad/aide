// The lock every move of a shared checkout takes, from both sides: the
// runner's `checkout_lock_take` in bash and the dashboard's
// `withCheckoutLock`. Each side is driven for real — a bash process
// holding the lock, a directory on disk — since the point is that two
// separate processes see each other.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkoutLockPath, takeOverGone, withCheckoutLock } from "../../../src/git/checkout-lock/index.ts";

const LIB = resolve(import.meta.dir, "../../../../core/scripts/lib/checkout-lock.sh");
const noWait = async (_ms: number): Promise<void> => {};

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory standing in for a shared checkout: the lock lives in its
 *  `.git`, and nothing else of a repository is needed. */
function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-checkout-lock-"));
  made.push(dir);
  mkdirSync(join(dir, ".git"));
  return dir;
}

/** `checkout_lock_take` against `root`, with a wait of `seconds`: its
 *  exit code. The bash process ends straight after, so a lock it took
 *  is left holding a pid that is gone. */
function bashTake(root: string, seconds: number): number {
  return Bun.spawnSync({
    cmd: ["bash", "-c", 'source "$1"; checkout_lock_take "$2" "$3"', "_", LIB, root, String(seconds)],
    stdout: "pipe",
    stderr: "pipe",
  }).exitCode;
}

/** A pid that was a process a moment ago and is not one any more. */
function gonePid(): number {
  return Number(Bun.spawnSync(["sh", "-c", "echo $$"]).stdout.toString().trim());
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("the lock's path", () => {
  test("bash and TypeScript name the same path for one checkout (AC-4)", () => {
    const root = checkout();
    const bash = Bun.spawnSync({
      cmd: ["bash", "-c", 'source "$1"; checkout_lock_path "$2"', "_", LIB, root],
      stdout: "pipe",
    }).stdout.toString().trim();
    expect(bash).toBe(checkoutLockPath(root));
  });
});

describe("the dashboard waits for the runner", () => {
  test("a move waits while a bash process holds the lock, and runs once it lets go (AC-1)", async () => {
    const root = checkout();
    const taken = join(root, "taken");
    const released = join(root, "released");
    const holder = Bun.spawn({
      cmd: [
        "bash", "-c",
        'source "$1"; checkout_lock_take "$2" 5 || exit 1; touch "$3"; sleep 0.6; touch "$4"; rm -rf "$(checkout_lock_path "$2")"',
        "_", LIB, root, taken, released,
      ],
    });
    try {
      await until(() => existsSync(taken));
      const result = await withCheckoutLock(root, async () => existsSync(released));
      expect(result).toEqual({ locked: true, value: true });
      expect(existsSync(checkoutLockPath(root))).toBe(false);
    } finally {
      holder.kill();
      await holder.exited;
    }
  });

  test("a lock whose pid is gone is taken over at once (AC-1)", async () => {
    const root = checkout();
    const lock = checkoutLockPath(root);
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), `${gonePid()}\n`);
    let polls = 0;
    const result = await withCheckoutLock(root, async () => readFileSync(join(lock, "pid"), "utf8").trim(), {
      wait: async () => {
        polls++;
      },
    });
    expect(result).toEqual({ locked: true, value: String(process.pid) });
    expect(polls).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });

  test("a live holder past the wait leaves the move unrun, and the answer names the lock (AC-1)", async () => {
    const root = checkout();
    const lock = checkoutLockPath(root);
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), `${process.ppid}\n`);
    let ran = false;
    const result = await withCheckoutLock(
      root,
      async () => {
        ran = true;
      },
      { waitMs: 1000, wait: noWait },
    );
    expect(ran).toBe(false);
    expect(result).toEqual({ locked: false, lock, owner: process.ppid });
    // Still the holder's.
    expect(readFileSync(join(lock, "pid"), "utf8").trim()).toBe(String(process.ppid));
  });

  test("a root with no .git directory runs the move and makes no lock (AC-1)", async () => {
    const root = mkdtempSync(join(tmpdir(), "aide-checkout-lock-bare-"));
    made.push(root);
    const result = await withCheckoutLock(root, async () => "moved");
    expect(result).toEqual({ locked: true, value: "moved" });
    expect(existsSync(join(root, ".git"))).toBe(false);
  });
});

describe("the runner waits for the dashboard", () => {
  test("checkout_lock_take gives up while the dashboard holds the lock, and takes it after (AC-2)", async () => {
    const root = checkout();
    const lock = checkoutLockPath(root);
    const during = await withCheckoutLock(root, async () => {
      const code = bashTake(root, 1);
      return { code, owner: readFileSync(join(lock, "pid"), "utf8").trim() };
    });
    expect(during).toEqual({ locked: true, value: { code: 1, owner: String(process.pid) } });
    expect(bashTake(root, 1)).toBe(0);
  });

  test("a move that throws still lets go of the lock (AC-2)", async () => {
    const root = checkout();
    await expect(
      withCheckoutLock(root, async () => {
        throw new Error("the move failed");
      }),
    ).rejects.toThrow("the move failed");
    expect(existsSync(checkoutLockPath(root))).toBe(false);
    expect(bashTake(root, 1)).toBe(0);
  });
});

describe("taking over a lock whose owner is gone", () => {
  test("a lock another taker made after the dead owner was read is left standing (AC-1)", () => {
    const root = checkout();
    const lock = checkoutLockPath(root);
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), `${gonePid()}\n`);
    const seen = statSync(lock).ino;
    // The runner takes it over in between: removes it and makes its own.
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), `${process.ppid}\n`);
    takeOverGone(lock, seen);
    expect(readFileSync(join(lock, "pid"), "utf8").trim()).toBe(String(process.ppid));
  });

  test("the dead owner's own lock is removed (AC-1)", () => {
    const root = checkout();
    const lock = checkoutLockPath(root);
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), `${gonePid()}\n`);
    takeOverGone(lock, statSync(lock).ino);
    expect(existsSync(lock)).toBe(false);
  });
});
