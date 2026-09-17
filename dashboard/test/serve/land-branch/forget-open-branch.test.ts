// The one line the landing gained (2026-09-09): a merge whose branch
// delete succeeded takes that branch out of the cached open set for the
// root it just changed. Without it, `peekOpenSpecBranches` — which the
// archived row reads — goes on naming a branch this process has already
// deleted, and the row says "its branch is still on origin — re-run
// archive" about a landing that succeeded. The landing's own `fresh`
// re-check corrects it, but not until the whole merge loop is over.

import { describe, expect, test } from "bun:test";
import { landBranch } from "../../../src/serve/land-branch";
import { BRANCH, landCtx, landingGit, REPOS, ROOT } from "./landing-fixtures.ts";
import type { Answer } from "../../helpers/fake-git.ts";

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
