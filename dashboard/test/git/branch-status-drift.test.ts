// Split out of branch-status.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker, type GitRunner } from "../../src/git/branch-status.ts";
import { fakeGit } from "../helpers/fake-git.ts";

const SYMREF_MASTER = {
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/master\n" },
};

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

// Spec 258: the Deploy route re-checks the count right after it changes
// the checkout, and must not report the old answer for the rest of the
// TTL — the same escape hatch `isMerged`'s own `fresh` tests prove.
describe("BranchStatusChecker.commitsBehindOrigin: fresh", () => {
  test("`fresh` bypasses the cache and re-asks git", async () => {
    let count = 3;
    const run: GitRunner = async (_dir, args) => {
      const joined = args.join(" ");
      if (joined.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (joined.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "master\n" };
      if (joined.startsWith("fetch")) return { code: 0, stdout: "" };
      if (joined.startsWith("rev-list --count")) return { code: 0, stdout: `${count}\n` };
      return { code: 1, stdout: "" };
    };
    const checker = new BranchStatusChecker({ run, ttlMs: 30_000, now: () => 1000 });
    expect(await checker.commitsBehindOrigin("/repo")).toBe(3);
    count = 0; // origin now says: level
    expect(await checker.commitsBehindOrigin("/repo")).toBe(3); // still cached, clock unmoved
    expect(await checker.commitsBehindOrigin("/repo", true)).toBe(0);
    // Refreshed, not merely bypassed: the next ordinary reader sees it too.
    expect(await checker.commitsBehindOrigin("/repo")).toBe(0);
  });

  test("an unanswerable fresh check does not leave the old answer standing", async () => {
    let reachable = true;
    const run: GitRunner = async (_dir, args) => {
      if (!reachable) throw new Error("no route to host");
      const joined = args.join(" ");
      if (joined.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (joined.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "master\n" };
      if (joined.startsWith("fetch")) return { code: 0, stdout: "" };
      if (joined.startsWith("rev-list --count")) return { code: 0, stdout: "3\n" };
      return { code: 0, stdout: "" };
    };
    const checker = new BranchStatusChecker({ run, ttlMs: 30_000, now: () => 1000 });
    expect(await checker.commitsBehindOrigin("/repo")).toBe(3);
    reachable = false;
    // Fail-open is unchanged by `fresh`: an unanswerable question is
    // `null`, and it overwrites the cached `3` rather than letting it
    // stand for the rest of the TTL.
    expect(await checker.commitsBehindOrigin("/repo", true)).toBeNull();
    expect(await checker.commitsBehindOrigin("/repo")).toBeNull();
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
