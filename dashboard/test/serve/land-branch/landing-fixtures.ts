import { WaitingQueue } from "../../../src/queue/waiting";
import { createRootLock } from "../../../src/serve/serve-helpers/config.ts";
// A `landBranch` that runs for real against a git that runs no git.
//
// Nothing here mocks a module: a `mock.module` is registered for the
// WHOLE `bun test` run, not for the file it is written in, so mocking
// `land-branch/merge.ts` or `git/branch-merge/` hands the fake to
// every other file in the same run — which is how one such mock took 54
// tests in the merge suite with it (2026-09-09).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landBranch } from "../../../src/serve/land-branch";
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
 *  what its own step needs (`testServers`, a richer `queue`) without
 *  restating the rest. */
export function landCtx(
  gitRun: ReturnType<typeof landingGit>["run"],
  extra: Record<string, unknown> = {},
): {
  ctx: Record<string, unknown>;
  forgotten: { root: string; branch: string }[];
  remembered: { root: string; branch: string }[];
  merged: { root: string; branch: string }[];
} {
  const forgotten: { root: string; branch: string }[] = [];
  const remembered: { root: string; branch: string }[] = [];
  const merged: { root: string; branch: string }[] = [];
  const ctx: Record<string, unknown> = {
    queue: {
      get: () => undefined,
      list: () => [],
      update: () => {},
      transition: () => ({ ok: true }),
      branchesFor: () => [],
      renamePendingModel: () => {},
    },
    gitRun,
    mergeLock: createRootLock(),
    machineryProjectDir: () => "/repos/aide-code",
    machinerySpecsRoot: () => ROOT,
    codeLanding: () => undefined,
    invalidateScan: () => {},
    warmSpec: async () => {},
    forgetSpec: () => {},
    rootsStillHolding: async () => [],
    branchStatus: {
      defaultBranch: async () => "master",
      invalidate: () => {},
      forgetOpenSpecBranch: (root: string, branch: string) => void forgotten.push({ root, branch }),
      rememberOpenSpecBranch: (root: string, branch: string) => void remembered.push({ root, branch }),
      rememberMerged: (root: string, branch: string) => void merged.push({ root, branch }),
    },
    ...extra,
  };
  const queue = ctx.queue as { waiting?: WaitingQueue };
  queue.waiting ??= new WaitingQueue({});
  return { ctx, forgotten, remembered, merged };
}

export const REPOS = [{ root: ROOT, url: "" }];

/** Lands `job`'s analyze branch into one fresh root, with the queue
 *  holding `job` merged with `current`, and returns the landing's own
 *  success patch: the update that names the branch. */
export async function landAnalyzeWhile(
  job: { id: string; project: string; specFolder: string },
  current: Record<string, unknown>,
  prefix: string,
): Promise<Record<string, unknown>> {
  const updates: Record<string, unknown>[] = [];
  const { ctx } = landCtx(landingGit().run, {
    queue: {
      get: () => ({ ...job, ...current }),
      update: (_id: string, patch: Record<string, unknown>) => void updates.push(patch),
      transition: (_id: string, event: string, patch?: Record<string, unknown>) => {
        updates.push({ event, ...(patch ?? {}) });
        return { ok: true };
      },
      branchesFor: () => [],
    },
    branchStatus: { defaultBranch: async () => "master", invalidate: () => {}, forgetOpenSpecBranch: () => {} },
  });
  const here = mkdtempSync(join(tmpdir(), prefix));
  await landBranch(
    ctx as unknown as Parameters<typeof landBranch>[0],
    job as unknown as Parameters<typeof landBranch>[1],
    { branch: BRANCH },
    {
      step: "analyze" as const,
      repos: [{ root: here, url: "" }],
      failedNote: (why: string) => ({ key: "landing.analyzeLandingFailed" as const, values: { why } }),
    } as unknown as Parameters<typeof landBranch>[3],
  );
  return updates.find((u) => "branchUrls" in u)!;
}
