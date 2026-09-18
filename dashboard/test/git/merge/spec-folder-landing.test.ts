// Where the specs live inside the code repo, one branch carries both.
// A round's analyze landed that branch whole, putting an earlier
// implement's code on main before archive; a close deleted it whole,
// taking the folder move with it (paceup:03, 2026-09-18). These land the
// spec's own folder alone.
//
// Real git, a real bare origin: the rule is about what origin's main
// holds afterwards, which a fake git can answer whatever the code does.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { landSpecFolderOnly } from "../../../src/git/spec-folder-landing.ts";

const FOLDER = "03-a-spec";
const BRANCH = `aide/${FOLDER}`;
const PATHS = [`specs/${FOLDER}`, `specs/archive/${FOLDER}`];
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const res = Bun.spawnSync(["git", ...args], { cwd });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  return res.stdout.toString();
}

function write(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A code repo with its specs inside it, and a spec branch on origin
 *  holding both code and spec changes. */
function repo(): { root: string; origin: string; work: string } {
  const base = mkdtempSync(join(tmpdir(), "aide-spec-folder-landing-"));
  dirs.push(base);
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  git(base, "clone", "-q", origin, work);
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "T");
  write(work, "src/app.ts", "old\n");
  write(work, `specs/${FOLDER}/1-description.md`, "described\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "first");
  git(work, "push", "-q", "origin", "main");
  git(work, "switch", "-q", "-c", BRANCH);
  write(work, "src/app.ts", "new code\n");
  write(work, `specs/${FOLDER}/2-analysis.md`, "analysed\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "analyze and implement");
  git(work, "push", "-q", "origin", BRANCH);
  git(work, "switch", "-q", "main");
  const root = join(base, "code");
  git(base, "clone", "-q", origin, root);
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  return { root, origin, work };
}

const onMain = (origin: string, path: string): string | null => {
  const res = Bun.spawnSync(["git", "show", `main:${path}`], { cwd: origin });
  return res.exitCode === 0 ? res.stdout.toString() : null;
};
const branchOnOrigin = (origin: string): boolean => git(origin, "branch", "--list", BRANCH).trim() !== "";

describe("landing a spec's own folder", () => {
  test("brings the spec files to main and leaves the code, and the branch, where they were", async () => {
    const { root, origin } = repo();
    const result = await landSpecFolderOnly(createGitRunner(), root, BRANCH, "main", {
      paths: PATHS, message: "Land it", deleteBranch: false,
    });
    expect(result.ok).toBe(true);
    expect(result.discarded).toBe(true);
    expect(onMain(origin, `specs/${FOLDER}/2-analysis.md`)).toBe("analysed\n");
    expect(onMain(origin, "src/app.ts")).toBe("old\n");
    expect(branchOnOrigin(origin)).toBe(true);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "main"));
  });

  test("a close carries the folder's move to archive/ and then deletes the branch", async () => {
    const { root, origin, work } = repo();
    git(work, "switch", "-q", BRANCH);
    mkdirSync(join(work, "specs", "archive"));
    git(work, "mv", `specs/${FOLDER}`, `specs/archive/${FOLDER}`);
    git(work, "commit", "-qm", "close");
    git(work, "push", "-q", "origin", BRANCH);
    const result = await landSpecFolderOnly(createGitRunner(), root, BRANCH, "main", {
      paths: PATHS, message: "Land it", deleteBranch: true,
    });
    expect(result.ok).toBe(true);
    expect(onMain(origin, `specs/archive/${FOLDER}/2-analysis.md`)).toBe("analysed\n");
    expect(onMain(origin, `specs/${FOLDER}/1-description.md`)).toBeNull();
    expect(onMain(origin, "src/app.ts")).toBe("old\n");
    expect(branchOnOrigin(origin)).toBe(false);
  });

  test("a second landing of the same files adds no commit", async () => {
    const { root, origin } = repo();
    const run = createGitRunner();
    const spec = { paths: PATHS, message: "Land it", deleteBranch: false };
    await landSpecFolderOnly(run, root, BRANCH, "main", spec);
    const once = git(origin, "rev-parse", "main");
    expect((await landSpecFolderOnly(run, root, BRANCH, "main", spec)).ok).toBe(true);
    expect(git(origin, "rev-parse", "main")).toBe(once);
  });

  test("a branch already gone is the ordinary refusal", async () => {
    const { root, work } = repo();
    git(work, "push", "-q", "origin", "--delete", BRANCH);
    const result = await landSpecFolderOnly(createGitRunner(), root, BRANCH, "main", {
      paths: PATHS, message: "Land it", deleteBranch: false,
    });
    expect(result.reason).toBe("gone");
  });
});
