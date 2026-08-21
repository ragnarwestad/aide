// Spec 04: whether a job's branch has landed on the project's default
// branch. Every git call is injected here, so the suite spawns no
// subprocess and asks its questions about the LOGIC: which refs are
// consulted, what an unresolvable answer degrades to, and how often git
// is asked at all.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker, specBranch, type GitRunner } from "../src/branch-status.ts";
import { fakeGit } from "./helpers/fake-git.ts";

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

  // Spec 89: one boolean per JOB was the bug. The cache key already
  // carried the directory, so the same branch name in two repos must
  // never share an answer — that is exactly how the page gave a
  // confident wrong "merged" for a specs repo it never asked.
  test("the cache is per repo too — the same branch name in two repos", async () => {
    const git = fakeGit({
      ...SYMREF_MASTER,
      "merge-base": { code: 1 },
    });
    const merged = fakeGit({ ...SYMREF_MASTER, "merge-base": { code: 0 } });
    const a = new BranchStatusChecker({ run: merged.run, now: () => 1000 });
    const b = new BranchStatusChecker({ run: git.run, now: () => 1000 });
    expect(await a.isMerged("/repos/aide", "aide/89-x")).toBe(true);
    expect(await b.isMerged("/repos/aide-specs", "aide/89-x")).toBe(false);
  });
});

// Spec 89: the merge code needs the same default branch the check
// already resolves, and a merge it just performed must be visible
// without waiting out the TTL of the answer it invalidates.
describe("BranchStatusChecker.defaultBranch", () => {
  test("is callable from outside, and answers from origin/HEAD", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.defaultBranch("/repo")).toBe("main");
  });

  test("falls back to probing main, then master", async () => {
    const git = fakeGit({
      "symbolic-ref": { code: 128 },
      "show-ref --verify --quiet refs/remotes/origin/main": { code: 1 },
      "show-ref --verify --quiet refs/remotes/origin/master": { code: 0 },
    });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.defaultBranch("/repo")).toBe("master");
  });

  test("a repo with no resolvable default branch answers null, never a guess", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 128 }, "show-ref": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.defaultBranch("/repo")).toBeNull();
  });
});

describe("BranchStatusChecker.invalidate", () => {
  test("a merged branch shows as merged on the next load, not 30 s later", async () => {
    // The answer is cached as "not merged", then the merge happens and
    // the entry is dropped. The clock does NOT move: without the drop
    // the second call would return the stale answer from cache.
    let ancestor = 1;
    const run: GitRunner = async (_dir, args) => {
      if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (args[0] === "merge-base") return { code: ancestor, stdout: "" };
      return { code: 0, stdout: "" };
    };
    const checker = new BranchStatusChecker({ run, ttlMs: 30_000, now: () => 1000 });
    expect(await checker.isMerged("/repo", "aide/89-x")).toBe(false);
    ancestor = 0;
    expect(await checker.isMerged("/repo", "aide/89-x")).toBe(false); // still cached
    checker.invalidate("/repo", "aide/89-x");
    expect(await checker.isMerged("/repo", "aide/89-x")).toBe(true);
  });

  test("only the one entry goes — another repo's answer still stands", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "merge-base": { code: 0 } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.isMerged("/repos/aide", "aide/89-x");
    await checker.isMerged("/repos/aide-specs", "aide/89-x");
    const before = git.calls.length;
    checker.invalidate("/repos/aide", "aide/89-x");
    await checker.isMerged("/repos/aide-specs", "aide/89-x"); // untouched: still cached
    expect(git.calls.length).toBe(before);
    await checker.isMerged("/repos/aide", "aide/89-x"); // dropped: asked again
    expect(git.calls.length).toBeGreaterThan(before);
  });
});

// Spec 99: the merge button now deletes the branch on origin, which is
// exactly the workflow the old "Known limitation" comment warned about.
// A branch git can PROVE is gone from origin has nothing left to merge,
// so the ancestry check it can no longer answer is not asked at all.
describe("BranchStatusChecker.isMerged: origin has forgotten the branch", () => {
  test("a branch confirmed absent from origin counts as merged (criterion 1)", async () => {
    const git = fakeGit({
      ...SYMREF_MASTER,
      "ls-remote": { code: 2 },
    });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/99-x")).toBe(true);
    // Nothing is fetched and no ancestry is computed for a ref that is
    // not there: the question is already answered.
    expect(git.calls.some((c) => c.args[0] === "fetch")).toBe(false);
    expect(git.calls.some((c) => c.args[0] === "merge-base")).toBe(false);
  });

  test("origin is asked directly, never through a local remote-tracking ref (criterion 1)", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "ls-remote": { code: 2 } });
    const checker = new BranchStatusChecker({ run: git.run });
    await checker.isMerged("/repo", "aide/99-x");
    const asked = git.calls.find((c) => c.args[0] === "ls-remote")!;
    expect(asked.args).toEqual([
      "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/aide/99-x",
    ]);
    expect(asked.dir).toBe("/repo");
  });

  test("a branch still on origin is answered the old way (criterion 2)", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "ls-remote": { code: 0 }, "merge-base": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/99-x")).toBe(false);
    expect(git.calls.some((c) => c.args[0] === "merge-base")).toBe(true);
  });

  // 128 is what an unreachable host exits with. Treating it as absence
  // would make the badge and the button vanish from open work during a
  // network blip — the one direction this check may never guess in.
  test("ls-remote failing for an unrelated reason still falls back (criterion 2)", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, "ls-remote": { code: 128 }, "merge-base": { code: 0 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.isMerged("/repo", "aide/99-x")).toBe(true);
    expect(git.calls.some((c) => c.args[0] === "merge-base")).toBe(true);
  });
});

// Spec 142: a merge made anywhere but the dashboard's own button runs
// no install, so the serving host goes on serving the old code with
// nothing saying so. The check that makes it visible asks a different
// question of the same checkout — not "did this branch land" but "is
// what is checked out here behind what origin has" — and it may never
// answer with a guess: a banner nobody can trust is worse than none.
describe("BranchStatusChecker.commitsBehindOrigin", () => {
  const ON_MASTER = {
    ...SYMREF_MASTER,
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "master\n" },
    fetch: { code: 0 },
  };

  test("a checkout level with origin is behind by nothing (criterion 1)", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "0\n" } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.commitsBehindOrigin("/repo")).toBe(0);
  });

  test("a checkout three commits behind says three (criterion 2)", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "3\n" } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.commitsBehindOrigin("/repo")).toBe(3);
    const counted = git.calls.find((c) => c.args[0] === "rev-list")!;
    expect(counted.args).toEqual([
      "rev-list", "--count", "HEAD..refs/remotes/origin/master",
    ]);
    expect(counted.dir).toBe("/repo");
  });

  // The same rule aide-pull-specs applies to a specs checkout: a tree
  // parked on another branch mid-investigation is not behind, it is
  // elsewhere, and calling that drift teaches a reader to ignore the
  // banner.
  test("a checkout on some other branch answers null, not a number (criterion 4)", async () => {
    const git = fakeGit({
      ...ON_MASTER,
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/142-x\n" },
      "rev-list --count": { code: 0, stdout: "9\n" },
    });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.commitsBehindOrigin("/repo")).toBeNull();
    expect(git.calls.some((c) => c.args[0] === "rev-list")).toBe(false);
  });

  test("a repo with no resolvable default branch answers null (criterion 5)", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 128 }, "show-ref": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.commitsBehindOrigin("/repo")).toBeNull();
  });

  test("a rev-list that fails answers null — never zero (criterion 5)", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 128 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.commitsBehindOrigin("/repo")).toBeNull();
  });

  test("a git that throws answers null and does not escape (criterion 5)", async () => {
    const run: GitRunner = async () => {
      throw new Error("no such directory");
    };
    const checker = new BranchStatusChecker({ run });
    expect(await checker.commitsBehindOrigin("/gone")).toBeNull();
  });

  // The fetch is what makes the answer current; without it the count is
  // whatever this checkout last happened to hear about origin.
  test("origin's default branch is fetched before the count, and nothing is merged", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "1\n" } });
    const checker = new BranchStatusChecker({ run: git.run });
    await checker.commitsBehindOrigin("/repo");
    expect(git.calls.find((c) => c.args[0] === "fetch")!.args).toEqual([
      "fetch", "--quiet", "origin", "master",
    ]);
    for (const forbidden of ["merge", "pull", "reset", "checkout"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });

  test("a second call inside the TTL spawns no git at all", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "2\n" } });
    let clock = 1000;
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    expect(await checker.commitsBehindOrigin("/repo")).toBe(2);
    const first = git.calls.length;
    expect(first).toBeGreaterThan(0);
    clock += 29_000;
    expect(await checker.commitsBehindOrigin("/repo")).toBe(2);
    expect(git.calls.length).toBe(first);
    clock += 2_000;
    expect(await checker.commitsBehindOrigin("/repo")).toBe(2);
    expect(git.calls.length).toBeGreaterThan(first);
  });

  // isMerged's cache holds a boolean and this one a number-or-null: one
  // map for both would answer either question with the other's answer.
  test("the drift answer has its own cache — isMerged's is not consulted", async () => {
    const git = fakeGit({
      ...ON_MASTER,
      "ls-remote": { code: 0 },
      "merge-base": { code: 0 },
      "rev-list --count": { code: 0, stdout: "4\n" },
    });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(await checker.isMerged("/repo", "aide/142-x")).toBe(true);
    expect(await checker.commitsBehindOrigin("/repo")).toBe(4);
  });

  test("the cache is per repo — one checkout's drift never stands in for another's", async () => {
    const git = fakeGit({
      ...ON_MASTER,
      "rev-list --count HEAD..refs/remotes/origin/master": { code: 0, stdout: "5\n" },
    });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(await checker.commitsBehindOrigin("/repos/aide")).toBe(5);
    const before = git.calls.length;
    expect(await checker.commitsBehindOrigin("/repos/atlasaurus")).toBe(5);
    expect(git.calls.length).toBeGreaterThan(before);
    expect(git.calls.some((c) => c.dir === "/repos/atlasaurus")).toBe(true);
  });
});
