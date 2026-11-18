// The session's own copy of a landed branch: removed once its content is
// on main, kept whenever it holds anything that is not.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/process/index.ts";
import { removeLandedCopy } from "../../../src/git/branch-merge/landed-copy.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const run = createGitRunner(10_000);
const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, encoding: "utf8", env: ENV }).trim();

/** A session checkout with `fix/x` in its own worktree, pushed, and its
 *  content landed on origin's main as one squashed commit. */
function session(): { checkout: string; tree: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "aide-bun-test-landed-copy-")));
  dirs.push(base);
  const origin = join(base, "origin.git");
  const checkout = join(base, "checkout");
  const tree = join(base, "checkout-fix");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  git(base, "init", "-q", "-b", "main", checkout);
  git(checkout, "remote", "add", "origin", origin);
  writeFileSync(join(checkout, "a.txt"), "a\n");
  git(checkout, "add", "a.txt");
  git(checkout, "commit", "-q", "-m", "Start");
  git(checkout, "push", "-q", "origin", "main");
  git(checkout, "worktree", "add", "-q", "-b", "fix/x", tree);
  writeFileSync(join(tree, "b.txt"), "b\n");
  git(tree, "add", "b.txt");
  git(tree, "commit", "-q", "-m", "Add b");
  // The landing, somewhere else: one squashed commit on origin's main.
  const board = join(base, "board");
  git(base, "clone", "-q", origin, board);
  git(board, "fetch", "-q", checkout, "fix/x:refs/remotes/session/fix-x");
  git(board, "merge", "-q", "--squash", "refs/remotes/session/fix-x");
  git(board, "commit", "-q", "-m", "Add b");
  git(board, "push", "-q", "origin", "main");
  return { checkout, tree };
}

describe("removeLandedCopy", () => {
  test("removes a clean worktree and the branch once the content is on main", async () => {
    const { checkout, tree } = session();
    const result = await removeLandedCopy(run, checkout, "fix/x", "main");
    expect(result.kept).toEqual([]);
    expect(existsSync(tree)).toBe(false);
    expect(git(checkout, "branch", "--list", "fix/x")).toBe("");
  });

  test("keeps a worktree with uncommitted changes, and its branch", async () => {
    const { checkout, tree } = session();
    writeFileSync(join(tree, "b.txt"), "changed\n");
    const result = await removeLandedCopy(run, checkout, "fix/x", "main");
    expect(result.removed).toEqual([]);
    expect(existsSync(tree)).toBe(true);
    expect(git(checkout, "branch", "--list", "fix/x")).toContain("fix/x");
  });

  test("keeps a branch with a commit that never landed", async () => {
    const { checkout, tree } = session();
    writeFileSync(join(tree, "c.txt"), "c\n");
    git(tree, "add", "c.txt");
    git(tree, "commit", "-q", "-m", "Add c");
    const result = await removeLandedCopy(run, checkout, "fix/x", "main");
    expect(result.removed).toEqual([]);
    expect(existsSync(tree)).toBe(true);
  });
});
