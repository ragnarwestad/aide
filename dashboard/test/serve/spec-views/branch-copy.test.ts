// `readBranchCopy`: a spec file's text, commit and time off the spec's
// open branch, as the spec page draws them. Real git, because what is
// under test is that the answer moves when a Save writes to the branch.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BranchStatusChecker, createGitRunner } from "../../../src/git/branch-status.ts";
import { commitTimeOf, writeStatusToBranch } from "../../../src/git/branch-file.ts";
import { readBranchCopy } from "../../../src/serve/spec-views/branch-copy.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { rootWithOrigin, specBranchAhead, specRelPath } from "../../helpers/branch-fixture.ts";

const SPEC = "81-queue-and-runner";
const ON_MAIN = "# Queue - Description\n\nAs it was on main.\n";
const ON_BRANCH = "# Queue - Description\n\nAs the branch has it.\n";
const SAVED = "# Queue - Description\n\nAs a Save left it.\n";

const harness = queueHarness("aide-branch-copy-");
afterEach(() => harness.cleanup());

const run = createGitRunner();

function context() {
  return {
    gitRun: run,
    // No cache: the branch this test opens is younger than the 30 s the page's checker remembers an answer for.
    branchStatus: new BranchStatusChecker({ run, ttlMs: 0 }),
    specsRoot: async (dir: string) => (await run(dir, ["rev-parse", "--show-toplevel"])).stdout.trim(),
  };
}

describe("readBranchCopy", () => {
  test("a spec with a branch gives the branch's text, its commit and that commit's time, and the Save's after a Save (AC-1)", async () => {
    const { dir } = harness.start({ description: ON_MAIN });
    const fx = specBranchAhead(dir, SPEC, { "1-description.md": ON_BRANCH });
    const specDir = join(dir, "root", "aide", "specs", SPEC);

    const first = await readBranchCopy(context(), specDir, SPEC, "1-description.md");

    expect(first?.text).toBe(ON_BRANCH);
    expect(first?.sha).toBe((await run(fx.origin, ["rev-parse", fx.branch])).stdout.trim());
    expect(first?.at).toBe(await commitTimeOf(run, fx.root, first!.sha) ?? undefined);

    const saved = await writeStatusToBranch(
      run, fx.root, fx.branch, [{ relPath: specRelPath(SPEC, "1-description.md"), text: SAVED }], first!.sha, "save",
    );
    expect(saved.ok, saved.note).toBe(true);

    const second = await readBranchCopy(context(), specDir, SPEC, "1-description.md");
    expect(second?.text).toBe(SAVED);
    expect(second?.sha).toBe((await run(fx.origin, ["rev-parse", fx.branch])).stdout.trim());
    expect(second?.sha).not.toBe(first?.sha);
  });

  test("a spec with no branch of its own gives null (AC-3)", async () => {
    const { dir } = harness.start({ description: ON_MAIN });
    rootWithOrigin(dir);

    const copy = await readBranchCopy(context(), join(dir, "root", "aide", "specs", SPEC), SPEC, "1-description.md");

    expect(copy).toBeNull();
  });
});
