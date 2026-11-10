// The per-root repeat in `landBranch` is wired to `landingRepeats`: a
// code merge refused by a conflict is merged once, and reported.

import { describe, expect, test } from "bun:test";
import { landBranch } from "../../../../src/serve/land-branch";
import { LANDING_RETRIES } from "../../../../src/git/branch-merge/index.ts";
import { BRANCH, landCtx, landingGit } from "../landing-fixtures.ts";

const CODE = "/repos/aide-code";
const JOB = { id: "job-1", project: "aide", specFolder: "150-spec" };

describe("a code-root merge refused by a conflict", () => {
  test("is merged once and not repeated (AC-3)", async () => {
    const git = landingGit({
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1 },
      "merge --abort": { code: 0 },
    });
    const events: string[] = [];
    const { ctx } = landCtx(git.run, {
      queue: {
        get: () => undefined,
        list: () => [],
        update: () => {},
        transition: (_id: string, event: string) => {
          events.push(event);
          return { ok: true };
        },
        branchesFor: () => [],
        renamePendingModel: () => {},
      },
    });
    await landBranch(
      ctx as unknown as Parameters<typeof landBranch>[0],
      JOB as unknown as Parameters<typeof landBranch>[1],
      { branch: BRANCH },
      {
        step: "archive",
        repos: [{ root: CODE, url: "" }],
        failedNote: (why: string) => ({ key: "landing.archiveLandingFailed" as const, values: { why, button: "Archive" } }),
      } as unknown as Parameters<typeof landBranch>[3],
    );
    const merges = git.calls.filter((c) => c.args.join(" ").startsWith("merge -q --no-edit"));
    expect(merges).toHaveLength(1 + LANDING_RETRIES.repeats.other);
    expect(merges).toHaveLength(1);
    expect(events).toEqual(["landing-failed"]);
  });
});
