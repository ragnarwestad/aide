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

// Spec 203: the page render reads this cache and never fills it. The
// filling is a background schedule's job, so what the request path
// needs is a read that asks git nothing at all — and one that hands
// back an OLD answer rather than none, so the row can label it.
describe("BranchStatusChecker.peekDrift", () => {
  const ON_MASTER = {
    ...SYMREF_MASTER,
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "master\n" },
    fetch: { code: 0 },
  };

  test("a repo nothing has ever asked about answers null, and spawns no git", async () => {
    const git = fakeGit(ON_MASTER);
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(checker.peekDrift("/repo")).toEqual({ behind: null, checkedAt: null });
    expect(git.calls.length).toBe(0);
  });

  test("after a check, it hands back that answer and when it was taken", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "3\n" } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.commitsBehindOrigin("/repo");
    const before = git.calls.length;
    expect(checker.peekDrift("/repo")).toEqual({ behind: 3, checkedAt: 1000 });
    // A read, not a check: the peek itself asked git nothing.
    expect(git.calls.length).toBe(before);
  });

  // The whole point of the freshness label: an old answer is SHOWN as
  // old, never withheld. A peek that reverted to null past the TTL
  // would put the page back to having nothing to say.
  test("past the TTL the same answer stands, with its original timestamp", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "3\n" } });
    let clock = 1000;
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.commitsBehindOrigin("/repo");
    clock += 60_000;
    expect(checker.peekDrift("/repo")).toEqual({ behind: 3, checkedAt: 1000 });
  });

  // Fail-open, preserved through the peek: git could not answer, but it
  // WAS asked — which is a different row from one nobody has asked yet.
  test("an unanswerable check is a real, timestamped null", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 128 }, "show-ref": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 5000 });
    await checker.commitsBehindOrigin("/repo");
    expect(checker.peekDrift("/repo")).toEqual({ behind: null, checkedAt: 5000 });
  });

  test("the peek is per repo — one checkout's answer never stands in for another's", async () => {
    const git = fakeGit({ ...ON_MASTER, "rev-list --count": { code: 0, stdout: "5\n" } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.commitsBehindOrigin("/repos/aide");
    expect(checker.peekDrift("/repos/atlasaurus")).toEqual({ behind: null, checkedAt: null });
  });
});

// Spec 193: a landing that failed is not a spec that is done.
//
// The queue's memory of its own pushes is not the answer to "does this
// spec still have a branch open" — origin is. This asks origin once per
// ROOT rather than once per branch, because both readers want the whole
// set: the archive landing checks one branch, and the two pages check
// every archived spec at once.
describe("BranchStatusChecker.openSpecBranches", () => {
  /** What `git ls-remote --heads` prints: sha, tab, full ref, one per
   *  line. Two spec branches and one that is not a spec branch at all —
   *  the pattern is what excludes the latter, and a fake that answered
   *  with it would let a wrong pattern pass. */
  const LISTED =
    "a3f9c21deadbeef0000000000000000000000000\trefs/heads/aide/191-one-answer\n" +
    "b7e1d05feedface0000000000000000000000000\trefs/heads/aide/178-nobody-waits\n";

  test("asks origin for the spec branches, and never with --exit-code", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    const checker = new BranchStatusChecker({ run: git.run });
    await checker.openSpecBranches("/repos/aide");
    const call = git.calls.find((c) => c.args[0] === "ls-remote")!;
    // `--exit-code` would make "this repo has no open spec branch" an
    // error, which is the ordinary answer for a healthy repo.
    expect(call.args).not.toContain("--exit-code");
    expect(call.args).toEqual(["ls-remote", "--heads", "origin", "refs/heads/aide/*"]);
    expect(call.dir).toBe("/repos/aide");
  });

  test("the branch names come out of the two-column output", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    const checker = new BranchStatusChecker({ run: git.run });
    const open = await checker.openSpecBranches("/repos/aide");
    expect([...open!].sort()).toEqual(["aide/178-nobody-waits", "aide/191-one-answer"]);
    expect(open!.has(specBranch("191-one-answer"))).toBe(true);
  });

  test("a repo with no spec branch is an empty set, never null", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: "" } });
    const checker = new BranchStatusChecker({ run: git.run });
    const open = await checker.openSpecBranches("/repos/aide");
    expect(open).not.toBeNull();
    expect(open!.size).toBe(0);
  });

  test("a nonzero exit is null: unanswerable, not 'no branches'", async () => {
    // 128 is an unreachable host. Reading it as an empty set would tell
    // every caller that nothing is open during a network blip.
    const git = fakeGit({ "ls-remote": { code: 128, stdout: "" } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.openSpecBranches("/repos/aide")).toBeNull();
  });

  test("one answer stands for the TTL, per root", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.openSpecBranches("/repos/aide");
    const before = git.calls.length;
    await checker.openSpecBranches("/repos/aide");
    expect(git.calls.length).toBe(before);
    // Another root is another question.
    await checker.openSpecBranches("/repos/aide-specs");
    expect(git.calls.length).toBeGreaterThan(before);
  });

  test("`fresh` bypasses the cache and replaces the entry", async () => {
    // The landing asks immediately after deleting the branch on origin,
    // so an answer cached up to 30 seconds earlier would report every
    // successful landing as unlanded.
    let stdout = LISTED;
    const run: GitRunner = async (_dir, args) =>
      args[0] === "ls-remote" ? { code: 0, stdout } : { code: 1, stdout: "" };
    const checker = new BranchStatusChecker({ run, ttlMs: 30_000, now: () => 1000 });
    expect((await checker.openSpecBranches("/repos/aide"))!.size).toBe(2);
    stdout = "";
    expect((await checker.openSpecBranches("/repos/aide"))!.size).toBe(2); // still cached
    expect((await checker.openSpecBranches("/repos/aide", true))!.size).toBe(0);
    // Refreshed, not merely bypassed: the next ordinary reader gets the
    // new answer too, with the clock unmoved.
    expect((await checker.openSpecBranches("/repos/aide"))!.size).toBe(0);
  });

  test("an unanswerable refresh does not leave the old answer standing", async () => {
    let code = 0;
    const run: GitRunner = async (_dir, args) =>
      args[0] === "ls-remote" ? { code, stdout: code === 0 ? LISTED : "" } : { code: 1, stdout: "" };
    const checker = new BranchStatusChecker({ run, ttlMs: 30_000, now: () => 1000 });
    expect((await checker.openSpecBranches("/repos/aide"))!.size).toBe(2);
    code = 128;
    expect(await checker.openSpecBranches("/repos/aide", true)).toBeNull();
    expect(await checker.openSpecBranches("/repos/aide")).toBeNull();
  });
});


// Spec 208: the same read `peekDrift` gives the drift count, for the
// question spec 193 added a day after spec 203 shipped the pattern —
// and added without it, which is what put a network `ls-remote` back on
// the spec list's render path.
describe("BranchStatusChecker.peekOpenSpecBranches", () => {
  const LISTED =
    "a3f9c21deadbeef0000000000000000000000000\trefs/heads/aide/191-one-answer\n" +
    "b7e1d05feedface0000000000000000000000000\trefs/heads/aide/178-nobody-waits\n";

  test("a root nothing has ever asked about answers null, and spawns no git", () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(checker.peekOpenSpecBranches("/repos/aide")).toEqual({ open: null, checkedAt: null });
    expect(git.calls.length).toBe(0);
  });

  test("after a check, it hands back that set and when it was taken", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.openSpecBranches("/repos/aide");
    const before = git.calls.length;
    const { open, checkedAt } = checker.peekOpenSpecBranches("/repos/aide");
    expect([...open!].sort()).toEqual(["aide/178-nobody-waits", "aide/191-one-answer"]);
    expect(checkedAt).toBe(1000);
    // A read, not a check: the peek itself asked git nothing.
    expect(git.calls.length).toBe(before);
  });

  // Shown stale, never withheld — the same rule `peekDrift` keeps, and
  // the reason the archive row can label how old its answer is.
  test("past the TTL the same set stands, with its original timestamp", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    let clock = 1000;
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.openSpecBranches("/repos/aide");
    clock += 60_000;
    expect(checker.peekOpenSpecBranches("/repos/aide").checkedAt).toBe(1000);
    expect(checker.peekOpenSpecBranches("/repos/aide").open!.size).toBe(2);
  });

  // Fail-open, preserved through the peek: asked and unanswerable is a
  // different root from one nobody has asked yet.
  test("an unanswerable check is a real, timestamped null", async () => {
    const git = fakeGit({ "ls-remote": { code: 128, stdout: "" } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 5000 });
    await checker.openSpecBranches("/repos/aide");
    expect(checker.peekOpenSpecBranches("/repos/aide")).toEqual({ open: null, checkedAt: 5000 });
  });

  test("the peek is per root — one repo's answer never stands in for another's", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED } });
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.openSpecBranches("/repos/aide");
    expect(checker.peekOpenSpecBranches("/repos/aide-specs")).toEqual({ open: null, checkedAt: null });
  });
});
