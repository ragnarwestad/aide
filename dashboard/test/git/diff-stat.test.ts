// Spec 452: AC-2's "which files this step wrote or deleted, with lines
// added and removed" — `aide-run-spec` already carries a step's own
// `headBefore`/`headAfter` per repo (2-analysis.md), so the only new
// question this dashboard has to ask git is a plain `diff --numstat`
// between the two.
//
// Answered with a fake runner, the same shape as every other git
// question in this codebase (`test/helpers/fake-git.ts`): the rule under
// test is what a `--numstat` line means, never whether git works.

import { describe, expect, test } from "bun:test";
import { diffStatBetween } from "../../src/git/diff-stat.ts";
import { fakeGit } from "../helpers/fake-git.ts";

describe("diffStatBetween", () => {
  test("reads added/removed line counts per file from git diff --numstat", async () => {
    const { run } = fakeGit({
      "diff --numstat": { code: 0, stdout: "12\t3\tsrc/queue/runner.ts\n0\t7\tsrc/old-file.ts\n" },
    });

    const entries = await diffStatBetween(run, "/repos/aide", "abc111", "abc222");

    expect(entries).toEqual([
      { path: "src/queue/runner.ts", added: 12, removed: 3, binary: false },
      { path: "src/old-file.ts", added: 0, removed: 7, binary: false },
    ]);
  });

  // git prints `-`/`-` instead of a number for a binary file. Coercing
  // that to `Number("-") || 0` would read as "0 added / 0 removed" — the
  // exact same shape as "unchanged" — which would tell a reader nothing
  // changed when a binary file, in fact, did (plan-review coherence
  // finding, 3-solution.md).
  test("a binary file's `-`/`-` line never reads as a false zero", async () => {
    const { run } = fakeGit({
      "diff --numstat": { code: 0, stdout: "-\t-\tassets/logo.png\n" },
    });

    const entries = await diffStatBetween(run, "/repos/aide", "abc111", "abc222");

    expect(entries).toEqual([{ path: "assets/logo.png", added: 0, removed: 0, binary: true }]);
  });

  test("headBefore === headAfter is answered without asking git at all", async () => {
    const { run, calls } = fakeGit({ "diff --numstat": { code: 0, stdout: "1\t1\tx.ts\n" } });

    const entries = await diffStatBetween(run, "/repos/aide", "sameSha", "sameSha");

    expect(entries).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("a git failure answers with no changed files, not a throw", async () => {
    const { run } = fakeGit({ "diff --numstat": { code: 128, stdout: "" } });

    expect(await diffStatBetween(run, "/repos/aide", "abc111", "abc222")).toEqual([]);
  });
});
