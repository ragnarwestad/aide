// What GitHub says about a spec's pull request, asked through `gh`. Only
// GitHub knows a pull request merged: a squash merge leaves the branch
// outside the default branch, so git calls it unmerged for good.
//
// This holds the question, the reading of the answer and nothing that runs
// a process; the caller hands in the runner, as `GitRunner` does for git.

/** One `gh` call: the arguments after `gh`, run in `dir`. */
export type GhRunner = (dir: string, args: string[]) => Promise<{ code: number; stdout: string }>;

/** `merged` is true only for a pull request that merged and none open;
 *  `headSha` is the head that merged. */
export interface PullRequestAnswer {
  merged: boolean;
  headSha?: string;
}

/** Every request, in every state, that was opened from `branch`. The link
 *  is not read: the row's link is the queue's own. */
export function pullRequestListArgs(branch: string): string[] {
  return ["pr", "list", "--head", branch, "--state", "all", "--json", "state,headRefOid", "--limit", "20"];
}

/** `null` for output that is not a JSON array: no answer, never "not
 *  merged". A request still open wins over a merged one, since a review
 *  that is open is not over. `gh` lists the newest request first. */
export function readPullRequestList(stdout: string): PullRequestAnswer | null {
  let list: unknown;
  try {
    list = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const requests = list as { state?: string; headRefOid?: string }[];
  if (requests.some((r) => r?.state === "OPEN")) return { merged: false };
  const merged = requests.find((r) => r?.state === "MERGED");
  return merged ? { merged: true, headSha: merged.headRefOid } : { merged: false };
}

/** `null` when `gh` could not answer. */
export async function askPullRequest(run: GhRunner, codeRoot: string, branch: string): Promise<PullRequestAnswer | null> {
  const result = await run(codeRoot, pullRequestListArgs(branch));
  return result.code === 0 ? readPullRequestList(result.stdout) : null;
}
