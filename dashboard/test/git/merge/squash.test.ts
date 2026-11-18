// The squash a code root's landing makes, against real git: one commit on
// the base with the tested merge's exact tree.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/process/index.ts";
import { squashMessage, squashOnto } from "../../../src/git/branch-merge/squash.ts";
import { mergeBranchIntoDefault } from "../../../src/git/branch-merge/index.ts";
import { BranchStatusChecker } from "../../../src/git/branch-status.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const run = createGitRunner(10_000);

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Board", GIT_AUTHOR_EMAIL: "board@example.com", GIT_COMMITTER_NAME: "Board", GIT_COMMITTER_EMAIL: "board@example.com" },
  }).trim();
}

function commit(dir: string, file: string, text: string, subject: string, author = "Board <board@example.com>"): void {
  writeFileSync(join(dir, file), text);
  git(dir, "add", file);
  git(dir, "commit", "-q", "--author", author, "-m", subject);
}

/** A repo with `main`, a branch `feature` of two commits that also merged
 *  main into itself, and main moved on since: the shape a spec branch has. */
function repo(): { dir: string; onto: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-bun-test-squash-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "a.txt", "a\n", "Start");
  git(dir, "switch", "-q", "-c", "feature");
  commit(dir, "b.txt", "b\n", "Add b", "Ann Dev <ann@example.com>");
  git(dir, "switch", "-q", "main");
  commit(dir, "c.txt", "c\n", "Add c on main");
  git(dir, "switch", "-q", "feature");
  git(dir, "merge", "-q", "--no-edit", "main");
  commit(dir, "d.txt", "d\n", "Add d", "Ann Dev <ann@example.com>");
  git(dir, "switch", "-q", "main");
  commit(dir, "e.txt", "e\n", "Add e on main");
  const onto = git(dir, "rev-parse", "HEAD");
  git(dir, "merge", "-q", "--no-edit", "feature");
  return { dir, onto };
}

describe("squashOnto", () => {
  test("a merged branch becomes one commit on the base with the merge's own tree", async () => {
    const { dir, onto } = repo();
    const tree = git(dir, "rev-parse", "HEAD^{tree}");
    expect(await squashOnto(run, dir, onto, squashMessage("feature"))).toBeUndefined();
    expect(git(dir, "rev-parse", "HEAD^{tree}")).toBe(tree);
    expect(git(dir, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1)).toEqual([onto]);
    expect(git(dir, "log", "-1", "--format=%an <%ae>")).toBe("Ann Dev <ann@example.com>");
  });

  test("the message lists the branch's own commits, not main's merged into it", async () => {
    const { dir, onto } = repo();
    await squashOnto(run, dir, onto, squashMessage("feature"));
    expect(git(dir, "log", "-1", "--format=%B")).toBe("feature\n\n- Add b\n- Add d");
  });

  test("one ordinary commit on the base is kept as it is", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-bun-test-squash-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    commit(dir, "a.txt", "a\n", "Start");
    const onto = git(dir, "rev-parse", "HEAD");
    commit(dir, "b.txt", "b\n", "Add b");
    const head = git(dir, "rev-parse", "HEAD");
    expect(await squashOnto(run, dir, onto, squashMessage("feature"))).toBeUndefined();
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
  });
});

describe("squashMessage", () => {
  test("a spec's title leads, with the commits under it", () => {
    expect(squashMessage("aide/9-x", "Show the state")(["Run implement", "Fix test"])).toBe(
      "Show the state\n\n- Run implement\n- Fix test\n",
    );
  });

  test("a single commit without a title is its own subject", () => {
    expect(squashMessage("fix/x")(["Fix the thing"])).toBe("Fix the thing\n");
  });
});

/** A clone with a bare origin: `feature` (two commits, pushed) and main
 *  moved on since, so the landing has to make a real merge. */
function landable(): { root: string; main: string; g: (...a: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "aide-bun-test-squash-land-"));
  const origin = mkdtempSync(join(tmpdir(), "aide-bun-test-squash-origin-"));
  dirs.push(root, origin);
  const g = (...a: string[]) => git(root, ...a);
  git(origin, "init", "-q", "--bare", "-b", "main");
  g("init", "-q", "-b", "main");
  g("remote", "add", "origin", origin);
  commit(root, "a.txt", "a\n", "Start");
  g("push", "-q", "origin", "main");
  g("switch", "-q", "-c", "feature");
  commit(root, "b.txt", "b\n", "Add b");
  commit(root, "d.txt", "d\n", "Add d");
  g("push", "-q", "origin", "feature");
  g("switch", "-q", "main");
  commit(root, "c.txt", "c\n", "Add c on main");
  g("push", "-q", "origin", "main");
  return { root, main: g("rev-parse", "HEAD"), g };
}

describe("a code root's landing", () => {
  test("puts one commit on main, deletes the branch and its local copy", async () => {
    const { root, main, g } = landable();
    const result = await mergeBranchIntoDefault(run, root, "feature", "main", async () => {}, undefined, undefined, {
      squashMessage: squashMessage("feature"),
    });
    expect(result.ok).toBe(true);
    g("fetch", "-q", "origin");
    expect(g("rev-list", "--parents", "-n", "1", "origin/main").split(" ").slice(1)).toEqual([main]);
    expect(g("log", "-1", "--format=%B", "origin/main")).toBe("feature\n\n- Add b\n- Add d");
    expect(g("ls-tree", "--name-only", "origin/main").split("\n")).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);
    expect(g("branch", "--list", "feature")).toBe("");
    expect(g("ls-remote", "origin", "feature")).toBe("");
  });

  test("keeps a local copy that has commits the landing never saw", async () => {
    const { root, g } = landable();
    g("switch", "-q", "feature");
    commit(root, "e.txt", "e\n", "Not pushed");
    g("switch", "-q", "main");
    const result = await mergeBranchIntoDefault(run, root, "feature", "main", async () => {}, undefined, undefined, {
      squashMessage: squashMessage("feature"),
    });
    expect(result.ok).toBe(true);
    expect(g("branch", "--list", "feature")).toBe("feature");
  });

  test("without a squash message lands the merge commit, as the specs repo does", async () => {
    const { root, g } = landable();
    const result = await mergeBranchIntoDefault(run, root, "feature", "main", async () => {});
    expect(result.ok).toBe(true);
    g("fetch", "-q", "origin");
    expect(g("rev-list", "--parents", "-n", "1", "origin/main").split(" ").length).toBe(3);
  });
});

describe("a squashed branch still on origin", () => {
  test("reads as merged once its content is on main, and not before", async () => {
    const { root, g } = landable();
    const status = new BranchStatusChecker({ run, ttlMs: 0 });
    expect(await status.isMerged(root, "feature", true)).toBe(false);
    g("merge", "-q", "--squash", "origin/feature");
    g("commit", "-q", "-m", "Squashed feature");
    g("push", "-q", "origin", "main");
    expect(await status.isMerged(root, "feature", true)).toBe(true);
  });
});
