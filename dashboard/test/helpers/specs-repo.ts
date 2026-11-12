// A specs repository a test can save in: the harness's `aide` project made a
// git repository with an origin of its own, so a save can commit and push.

import { join } from "node:path";

const git = (cwd: string, ...args: string[]): void => {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
};

/** Makes `<dir>/root/aide` a repository on `main`, tracking a bare origin beside it. */
export const makeSpecsRepo = (dir: string): void => {
  const project = join(dir, "root", "aide");
  const origin = join(dir, "specs-origin.git");
  git(project, "init", "-q", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.com");
  git(project, "add", ".");
  git(project, "commit", "-qm", "initial specs");
  const cloned = Bun.spawnSync(["git", "clone", "-q", "--bare", project, origin]);
  if (cloned.exitCode !== 0) throw new Error(cloned.stderr.toString());
  git(project, "remote", "add", "origin", origin);
  git(project, "fetch", "-q", "origin");
  git(project, "branch", "--set-upstream-to=origin/main", "main");
};
