// A landed folder becomes visible when the shared checkout fast-forwards
// — the watcher rescans, the page re-renders. Two things the page reads
// used to be settled only when the whole landing was over, seconds
// later: a create job's key (it kept its provisional key while the
// scan already showed the numbered folder — two rows for one spec), and
// the cached open-branch set an archived row reads (it still named the
// branch, and the row said "still on origin — re-run archive"). Both
// are settled before the checkout moves now.
import { describe, expect, test } from "bun:test";

import { landBranch } from "../../../src/serve/land-branch";
import { BRANCH, landCtx, landingGit, REPOS, ROOT } from "./landing-fixtures.ts";

const ffIndex = (calls: { dir: string; args: string[] }[]): number =>
  calls.findIndex((c) => c.dir === ROOT && c.args.join(" ") === "merge -q --ff-only origin/master");

describe("what is settled before the checkout moves", () => {
  test("a create job carries its assigned folder before the numbered folder can be seen", async () => {
    const git = landingGit({ reset: { code: 0 } });
    const updates: { at: number; patch: Record<string, unknown> }[] = [];
    const renames: { at: number; project: string; from: string; to: string }[] = [];
    const { ctx } = landCtx(git.run, {
      queue: {
        get: () => undefined,
        update: (_id: string, patch: Record<string, unknown>) => void updates.push({ at: git.calls.length, patch }),
        transition: () => ({ ok: true }),
        branchesFor: () => [],
        renamePendingModel: (project: string, from: string, to: string) =>
          void renames.push({ at: git.calls.length, project, from, to }),
      },
      finalizeCreateSpec: async () => ({ ok: true, specFolder: "151-the-real-name" }),
    });
    const job = { id: "job-1", project: "aide", specFolder: "new-abcd1234" };
    await landBranch(
      ctx as unknown as Parameters<typeof landBranch>[0],
      job as unknown as Parameters<typeof landBranch>[1],
      { branch: BRANCH },
      {
        step: "create",
        repos: REPOS,
        failedNote: (why: string) => ({ key: "landing.createLandingFailed", values: { why } }),
      } as unknown as Parameters<typeof landBranch>[3],
    );
    const ff = ffIndex(git.calls);
    expect(ff).toBeGreaterThan(-1);
    const renamed = updates.find((u) => u.patch.specFolder === "151-the-real-name");
    expect(renamed).toBeDefined();
    expect(renamed!.at).toBeLessThanOrEqual(ff);
    // The pendingModels entry moves the same moment the job's own
    // specFolder does, before the checkout moves (spec 465).
    const modelRename = renames.find((r) => r.project === "aide" && r.from === "new-abcd1234" && r.to === "151-the-real-name");
    expect(modelRename).toBeDefined();
    expect(modelRename!.at).toBeLessThanOrEqual(ff);
  });

  test("the open-branch set forgets the branch before the checkout moves, under every root the cache is keyed by", async () => {
    const git = landingGit();
    const forgotten: { at: number; root: string; branch: string }[] = [];
    const { ctx } = landCtx(git.run, {
      // The specs path sits below the repo root the merge is about — the
      // key the archived row's own check asks the cache under.
      machinerySpecsRoot: () => `${ROOT}/aide`,
      branchStatus: {
        defaultBranch: async () => "master",
        invalidate: () => {},
        forgetOpenSpecBranch: (root: string, branch: string) => void forgotten.push({ at: git.calls.length, root, branch }),
        rememberOpenSpecBranch: () => {},
      },
    });
    await landBranch(
      ctx as unknown as Parameters<typeof landBranch>[0],
      { id: "job-1", project: "aide", specFolder: "150-spec" } as unknown as Parameters<typeof landBranch>[1],
      { branch: BRANCH },
      {
        step: "archive",
        repos: REPOS,
        failedNote: (why: string) => ({ key: "landing.archiveLandingFailed", values: { why } }),
      } as unknown as Parameters<typeof landBranch>[3],
    );
    const ff = ffIndex(git.calls);
    expect(ff).toBeGreaterThan(-1);
    expect(forgotten.some((f) => f.root === ROOT && f.branch === BRANCH && f.at <= ff)).toBe(true);
    expect(forgotten.some((f) => f.root === `${ROOT}/aide` && f.branch === BRANCH && f.at <= ff)).toBe(true);
    expect(forgotten.some((f) => f.root === "/repos/aide-code")).toBe(false);
  });
});

describe("what is settled once the landing has moved the folder", () => {
  test("both cached git answers for the spec are due for a fresh read, under either path", async () => {
    const git = landingGit();
    const history: [string, string][] = [];
    const fileSteps: [string, string][] = [];
    const { ctx } = landCtx(git.run, {
      workflowHistory: { forget: (dir: string, folder: string) => void history.push([dir, folder]) },
      branchFileSteps: { forget: (dir: string, folder: string) => void fileSteps.push([dir, folder]) },
    });
    await landBranch(
      ctx as unknown as Parameters<typeof landBranch>[0],
      { id: "job-1", project: "aide", specFolder: "150-spec" } as unknown as Parameters<typeof landBranch>[1],
      { branch: BRANCH },
      {
        step: "archive",
        repos: REPOS,
        failedNote: (why: string) => ({ key: "landing.archiveLandingFailed", values: { why } }),
      } as unknown as Parameters<typeof landBranch>[3],
    );
    const expected: [string, string][] = [[`${ROOT}/archive/150-spec`, "150-spec"], [`${ROOT}/150-spec`, "150-spec"]];
    expect(history).toEqual(expected);
    expect(fileSteps).toEqual(expected);
  });
});
