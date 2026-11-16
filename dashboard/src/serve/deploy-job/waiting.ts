// Whether the board's own project has something to deploy: commits on
// origin's default branch, as the drift poll last fetched it, that this
// server does not run. The same range the Deploy tab lists
// (`pendingCommits`), asked as a count off the request path, so the
// header can show its Deploy mark without a page waiting on git.

import { resolve } from "node:path";
import type { GitRunner } from "../../git/process/index.ts";
import type { DeployWaiting } from "../../render/ui/deploy-mark/index.ts";

export interface DeployWaitingInputs {
  projects: readonly string[];
  projectDir: (project: string) => string;
  /** The commit this process serves and the repository it runs from. */
  serving: { sha: string | null; repoRoot: string | null };
  /** Whether Deploy is offered for a project's checkout: it needs an install command. */
  canDeploy: (root: string) => boolean;
  /** Whether the latest drift check fetched origin successfully. */
  reachedOrigin: (root: string) => boolean;
  defaultBranch: (root: string) => Promise<string | null>;
  run: GitRunner;
}

/** The board's own project and its commit count when it has commits to deploy; nothing otherwise, or when git cannot say. */
export async function deployWaiting(o: DeployWaitingInputs): Promise<DeployWaiting | undefined> {
  const { sha, repoRoot } = o.serving;
  if (!sha || !repoRoot) return undefined;
  const project = o.projects.find((p) => resolve(o.projectDir(p)) === resolve(repoRoot));
  if (!project) return undefined;
  const root = o.projectDir(project);
  if (!o.canDeploy(root)) return undefined;
  const base = await o.defaultBranch(root).catch(() => null);
  if (!base) return undefined;
  if (!o.reachedOrigin(root)) return undefined;
  const count = await o.run(root, ["rev-list", "--count", `${sha}..refs/remotes/origin/${base}`]).catch(() => null);
  const ahead = count?.code === 0 ? Number.parseInt(count.stdout.trim(), 10) : NaN;
  if (ahead > 0) return { project, commits: ahead, branch: base };
  return ahead === 0 ? { project, commits: 0, branch: base } : undefined;
}
