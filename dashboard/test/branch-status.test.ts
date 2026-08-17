// Spec 04: whether a job's branch has landed on the project's default
// branch. Every git call is injected here, so the suite spawns no
// subprocess and asks its questions about the LOGIC: which refs are
// consulted, what an unresolvable answer degrades to, and how often git
// is asked at all.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker, specBranch, type GitRunner } from "../src/branch-status.ts";

interface Call {
  dir: string;
  args: string[];
}

/** A runner that answers from a table of `argv[0] argv[1]` prefixes and
 *  records everything it was asked. */
function fakeGit(answers: Record<string, { code: number; stdout?: string }>) {
  const calls: Call[] = [];
  const run: GitRunner = async (dir, args) => {
    calls.push({ dir, args });
    for (const [prefix, answer] of Object.entries(answers)) {
      if (args.join(" ").startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
    }
    return { code: 1, stdout: "" };
  };
  return { run, calls };
}

const SYMREF_MASTER = {
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/master\n" },
};

describe("specBranch", () => {
  test("a spec folder names the branch the runner pushed to", () => {
    expect(specBranch("04-unmerged-work-is-invisible")).toBe("aide/04-unmerged-work-is-invisible");
  });
});

describe("BranchStatusChecker.isMerged", () => {
  test("a branch that is an ancestor of the default branch is merged", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "merge-base": { code: 0 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/02-job-detail-view")).toBe(true);
    const mergeBase = git.calls.find((c) => c.args[0] === "merge-base")!;
    expect(mergeBase.args).toEqual([
      "merge-base", "--is-ancestor",
      "refs/remotes/origin/aide/02-job-detail-view",
      "refs/remotes/origin/master",
    ]);
    expect(mergeBase.dir).toBe("/repo");
  });

  test("a branch that is not an ancestor is not merged", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "merge-base": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(false);
  });

  test("the default branch comes from origin/HEAD, whatever it is named", async () => {
    const git = fakeGit({
      "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
      "merge-base": { code: 0 },
    });
    const checker = new BranchStatusChecker({ run: git.run });
    await checker.isMerged("/repo", "aide/04-x");
    expect(git.calls.find((c) => c.args[0] === "merge-base")!.args[3]).toBe("refs/remotes/origin/main");
  });

  test("without origin/HEAD it probes main, then master", async () => {
    // symbolic-ref fails; `show-ref` says main is absent and master exists.
    const git = fakeGit({
      "symbolic-ref": { code: 128 },
      "show-ref --verify --quiet refs/remotes/origin/main": { code: 1 },
      "show-ref --verify --quiet refs/remotes/origin/master": { code: 0 },
      "merge-base": { code: 0 },
    });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(true);
    expect(git.calls.find((c) => c.args[0] === "merge-base")!.args[3]).toBe("refs/remotes/origin/master");
  });

  test("a fetch that fails does not stop the check — the checkout may already know", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, fetch: { code: 128 }, "merge-base": { code: 0 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/02-job-detail-view")).toBe(true);
  });

  test("no resolvable default branch means not merged, never a throw", async () => {
    const git = fakeGit({
      "symbolic-ref": { code: 128 },
      "show-ref": { code: 1 },
      "merge-base": { code: 0 },
    });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(false);
    // Never guesses past an unknown default: no merge-base was run at all.
    expect(git.calls.some((c) => c.args[0] === "merge-base")).toBe(false);
  });

  test("a runner that throws resolves to not merged, not a crash", async () => {
    const run: GitRunner = async () => {
      throw new Error("no such directory");
    };
    const checker = new BranchStatusChecker({ run });
    expect(await checker.isMerged("/gone", "aide/04-x")).toBe(false);
  });

  test("a second check inside the TTL spawns no git at all", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "merge-base": { code: 0 } });
    let clock = 1000;
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(true);
    const first = git.calls.length;
    expect(first).toBeGreaterThan(0);
    clock += 29_000;
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(true);
    expect(git.calls.length).toBe(first);
  });

  test("past the TTL the question is asked again — a merge happens after the answer was cached", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "merge-base": { code: 1 } });
    let clock = 1000;
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(false);
    const first = git.calls.length;
    clock += 31_000;
    expect(await checker.isMerged("/repo", "aide/04-x")).toBe(false);
    expect(git.calls.length).toBeGreaterThan(first);
  });

  test("the cache is per branch — one answer never stands in for another", async () => {
    const git = fakeGit({
      ...SYMREF_MASTER,
      "merge-base --is-ancestor refs/remotes/origin/aide/merged": { code: 0 },
      "merge-base": { code: 1 },
    });
    const checker = new BranchStatusChecker({ run: git.run, now: () => 1000 });
    expect(await checker.isMerged("/repo", "aide/merged")).toBe(true);
    expect(await checker.isMerged("/repo", "aide/open")).toBe(false);
  });
});
