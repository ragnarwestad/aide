// A `queueHarness` project tree turned into a real git repository with an
// origin, and a spec branch ahead of the default branch — the shape a
// spec has between `analyze` and `archive`. The tests that draw the spec
// page or post a Save against it run real git, because a fake answers by
// command string and cannot tell a stamp that moved from one that did not.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface BranchFixture {
  /** The projects root: the specs repository's working tree. */
  root: string;
  /** The bare repository the root pushes to. */
  origin: string;
  /** `aide/<folder>` */
  branch: string;
}

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** Where a spec's file sits in the repository. */
export const specRelPath = (folder: string, file: string, project = "aide"): string =>
  `${project}/specs/${folder}/${file}`;

/** The harness's `root` as a repository on `main`, everything committed
 *  and pushed to a new bare origin beside it. */
export function rootWithOrigin(dir: string): Omit<BranchFixture, "branch"> {
  const root = join(dir, "root");
  const origin = join(dir, "origin.git");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "the projects root as it was found");
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");
  return { root, origin };
}

/** `rootWithOrigin`, plus `aide/<folder>` on origin holding `files` (by
 *  file name, inside the spec's folder) one commit ahead of `main`. The
 *  branch is never checked out in `root`: the page reads it off origin. */
export function specBranchAhead(dir: string, folder: string, files: Record<string, string>): BranchFixture {
  const base = rootWithOrigin(dir);
  const branch = `aide/${folder}`;
  const work = mkdtempSync(join(tmpdir(), "aide-branch-work-"));
  git(tmpdir(), "clone", "-q", base.origin, work);
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.com");
  git(work, "checkout", "-qb", branch);
  for (const [file, text] of Object.entries(files)) {
    const path = join(work, specRelPath(folder, file));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  git(work, "add", "-A");
  git(work, "commit", "-qm", "the branch is ahead");
  git(work, "push", "-q", "origin", branch);
  rmSync(work, { recursive: true, force: true });
  return { ...base, branch };
}

/** A spec file as `ref` (`main` or the branch) holds it on origin. */
export function onOrigin(fx: Pick<BranchFixture, "origin">, ref: string, folder: string, file: string): string {
  return git(fx.origin, "show", `${ref}:${specRelPath(folder, file)}`);
}
