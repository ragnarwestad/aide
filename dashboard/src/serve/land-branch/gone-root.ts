import { existsSync } from "node:fs";

/** A landing carries every root the spec's older jobs ever named
 *  (`branchesFor`), and a root recorded before the dashboard's files
 *  moved is not on disk any more. That is a record from another life of
 *  this dashboard, not a repo the step touched: the step's own outcome
 *  never names it. With another root still to land, it is skipped and
 *  said so, rather than failing a landing whose work is otherwise in
 *  order. A root the step itself named, or the only root there is, is
 *  never skipped — the failure it always was stands. */
export function isGoneHistoryRoot(root: string, repos: { root: string }[], outcomeRoots: { root: string }[]): boolean {
  return !existsSync(root) && !outcomeRoots.some((r) => r.root === root) && repos.length > 1;
}

export function logSkippedRoot(job: { project: string; specFolder: string }, root: string): void {
  console.error(
    `queue: landing ${job.project}/${job.specFolder} skips ${root} — no such directory ` +
      "(a branch record from before this dashboard's files moved)",
  );
}
