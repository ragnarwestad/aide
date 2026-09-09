// A `landBranch` that runs for real against a git that runs no git.
//
// Nothing here mocks a module: a `mock.module` is registered for the
// WHOLE `bun test` run, not for the file it is written in, so mocking
// `land-branch/merge.ts` or `git/branch-merge.ts` hands the fake to
// every other file in the same run — which is how one such mock took 54
// tests in the merge suite with it (2026-09-09).

import { CLEAN_MASTER, fakeGit, type Answer } from "../../helpers/fake-git.ts";

export const ROOT = "/repos/aide";
export const BRANCH = "aide/150-spec";

/** A git that fast-forwards, pushes and deletes the branch. Any single
 *  answer can be overridden — the merge and the delete are the two a
 *  caller turns red one at a time. */
export function landingGit(over: Record<string, Answer> = {}) {
  return fakeGit({
    ...CLEAN_MASTER,
    "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
    pull: { code: 0 },
    "merge -q --ff-only": { code: 0 },
    "push -q origin --delete": { code: 0 },
    push: { code: 0 },
    switch: { code: 0 },
    fetch: { code: 0 },
    branch: { code: 0 },
    "ls-remote": { code: 0, stdout: `deadbeef\trefs/heads/${BRANCH}\n` },
    ...over,
  });
}

/** Every ctx field `landBranch` reads on the way through a single-repo
 *  merge, and nothing else. `extra` is merged in last, so a caller adds
 *  what its own step needs (`boards`, a richer `queue`) without
 *  restating the rest. */
export function landCtx(
  gitRun: ReturnType<typeof landingGit>["run"],
  extra: Record<string, unknown> = {},
): { ctx: Record<string, unknown>; forgotten: { root: string; branch: string }[] } {
  const forgotten: { root: string; branch: string }[] = [];
  const ctx: Record<string, unknown> = {
    queue: { get: () => undefined, update: () => {}, transition: () => ({ ok: true }), branchesFor: () => [] },
    gitRun,
    mergeLock: { run: async (_root: string, fn: () => Promise<unknown>) => fn() },
    machineryProjectDir: () => "/repos/aide-code",
    machinerySpecsRoot: () => ROOT,
    codeLanding: () => undefined,
    invalidateScan: () => {},
    warmSpec: async () => {},
    rootsStillHolding: async () => [],
    branchStatus: {
      defaultBranch: async () => "master",
      invalidate: () => {},
      forgetOpenSpecBranch: (root: string, branch: string) => void forgotten.push({ root, branch }),
    },
    ...extra,
  };
  return { ctx, forgotten };
}

export const REPOS = [{ root: ROOT, url: "" }];
