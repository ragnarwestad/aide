// Merging a spec's branch into a repo's default branch and pushing it,
// and the two other moves a landing or a deploy makes on a repo.

export { deleteBranchOnly } from "./delete-branch.ts";
export { fastForwardToOrigin } from "./fast-forward.ts";
export { type LandingGate, mergeBranchIntoDefault, mergeWorktreePath } from "./merge.ts";
export { refuse, type RepoMergeResult } from "./result.ts";
export { GIT_LOCKED, LOCK_RETRIES, LOCK_WAIT_MS, pushWithRetry, sleep, type Wait } from "./retry.ts";
