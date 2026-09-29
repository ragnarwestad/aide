// The one line the landing gained (2026-09-09): a merge whose branch
// delete succeeded takes that branch out of the cached open set for the
// root it just changed. Without it, `peekOpenSpecBranches` — which the
// archived row reads — goes on naming a branch this process has already
// deleted, and the row says "its branch is still on origin — re-run
// archive" about a landing that succeeded. The landing's own `fresh`
// re-check corrects it, but not until the whole merge loop is over.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker } from "../../../src/git/branch-status.ts";
import { landBranch } from "../../../src/serve/land-branch";
import { rememberMergedUnderRoots } from "../../../src/serve/land-branch/handed-to-merge.ts";
import { BRANCH, landCtx, landingGit, REPOS, ROOT } from "./landing-fixtures.ts";
import { fakeGit, type Answer } from "../../helpers/fake-git.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "150-spec" };
const LANDING = {
  step: "analyze" as const,
  repos: REPOS,
  failedNote: (why: string) => ({ key: "landing.analyzeLandingFailed" as const, values: { why } }),
};

async function land(over: Record<string, Answer> = {}) {
  const { ctx, forgotten, remembered } = landCtx(landingGit(over).run);
  await landBranch(
    ctx as unknown as Parameters<typeof landBranch>[0],
    JOB as unknown as Parameters<typeof landBranch>[1],
    { branch: BRANCH },
    LANDING as unknown as Parameters<typeof landBranch>[3],
  );
  return { forgotten, remembered };
}

describe("a landing forgets the branch it deleted", () => {
  test("names the root it merged and the branch it deleted", async () => {
    expect(await land()).toEqual({ forgotten: [{ root: ROOT, branch: BRANCH }], remembered: [] });
  });

  // Spec 319: the merge succeeded and only the delete failed, so the
  // branch IS still on origin. It was forgotten before the checkout
  // moved, so it is taken back — the one case the archived row's own
  // sentence exists for must still read as open.
  test("a delete that failed puts the branch back into the cached answer", async () => {
    expect(await land({ "push -q origin --delete": { code: 1, stderr: "remote rejected" } })).toEqual({
      forgotten: [{ root: ROOT, branch: BRANCH }],
      remembered: [{ root: ROOT, branch: BRANCH }],
    });
  });

  test("a merge that never went through forgets nothing", async () => {
    expect(await land({ "merge -q --ff-only": { code: 1 }, "merge -q --no-edit": { code: 1 } })).toEqual({ forgotten: [], remembered: [] });
  });
});

// A merge whose delete failed leaves a branch that is still on origin
// but already part of the default branch. The landing knows that at
// once, so the archived row reads "merged" on its very next draw rather
// than "not landed" until the background sweep asks git.
describe("a landing whose delete failed records the branch as merged", () => {
  const refusedDelete = { "push -q origin --delete": { code: 1, stderr: "remote rejected" } };

  async function landAs(step: string, over: Record<string, Answer>, extra: Record<string, unknown> = {}) {
    const { ctx, merged } = landCtx(landingGit(over).run, extra);
    await landBranch(
      ctx as unknown as Parameters<typeof landBranch>[0],
      JOB as unknown as Parameters<typeof landBranch>[1],
      { branch: BRANCH },
      { ...LANDING, step } as unknown as Parameters<typeof landBranch>[3],
    );
    return merged;
  }

  test("under every root the open set is keyed by, a specs root below its repository included (AC-1)", async () => {
    const specsRoot = `${ROOT}/specs/aide`;
    expect(await landAs("archive", refusedDelete, { machinerySpecsRoot: () => specsRoot })).toEqual([
      { root: ROOT, branch: BRANCH },
      { root: specsRoot, branch: BRANCH },
    ]);
  });

  test("the recorded answer is what the row peeks under the specs root's own path (AC-1)", () => {
    const checker = new BranchStatusChecker({ run: fakeGit({}).run });
    const specsRoot = "/repos/aide-specs/aide";
    rememberMergedUnderRoots(
      { machineryProjectDir: () => "/repos/aide-code", machinerySpecsRoot: () => specsRoot, branchStatus: checker },
      "aide",
      "/repos/aide-specs",
      BRANCH,
    );
    expect(checker.peekMerged(specsRoot, BRANCH)).toBe(true);
    expect(checker.peekMerged("/repos/aide-code", BRANCH)).toBeNull();
  });

  test("a delete that succeeded records nothing (AC-1)", async () => {
    expect(await landAs("archive", {})).toEqual([]);
  });

  test("a close's discarded code branch was never merged, and records nothing (AC-4)", async () => {
    // The code root is the one a close discards: `deleteBranchOnly`, no merge.
    const separateSpecs = { machineryProjectDir: () => ROOT, machinerySpecsRoot: () => "/repos/aide-specs" };
    expect(await landAs("close", refusedDelete, separateSpecs)).toEqual([]);
  });
});
