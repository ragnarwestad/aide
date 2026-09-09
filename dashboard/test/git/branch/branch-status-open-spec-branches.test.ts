// Split out of branch-status.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker, specBranch, type GitRunner } from "../../../src/git/branch-status.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

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

// Spec 298: `resolveOpenBranchTarget` is now called once per LIVE spec,
// concurrently, inside `warmSpec`'s own `Promise.all` — a new call shape
// this cache was never exercised against. Without de-duplication, N
// specs sharing one cold root each fire their own `ls-remote` the same
// tick; with it, the second caller onward awaits the first's own
// in-flight promise instead.
describe("BranchStatusChecker.openSpecBranches in-flight de-duplication", () => {
  const LISTED = "a3f9c21deadbeef0000000000000000000000000\trefs/heads/aide/191-one-answer\n";

  /** A fake whose `ls-remote` does not resolve until `release()` is
   *  called — so two calls started before either resolves can be proven
   *  to have shared one spawn. */
  function gatedGit() {
    const calls: string[][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const run: GitRunner = async (_dir, args) => {
      calls.push(args);
      await gate;
      return { code: 0, stdout: LISTED };
    };
    return { run, calls, release: () => release() };
  }

  test("two concurrent calls for the same root spawn exactly one ls-remote", async () => {
    const git = gatedGit();
    const checker = new BranchStatusChecker({ run: git.run });
    const first = checker.openSpecBranches("/repos/aide", false);
    const second = checker.openSpecBranches("/repos/aide", false);
    git.release();
    const [a, b] = await Promise.all([first, second]);
    expect(git.calls.length).toBe(1);
    expect([...a!]).toEqual([...b!]);
  });

  test("a third call after the first two settled, within the TTL, spawns nothing new", async () => {
    const git = gatedGit();
    const checker = new BranchStatusChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    const first = checker.openSpecBranches("/repos/aide", false);
    const second = checker.openSpecBranches("/repos/aide", false);
    git.release();
    await Promise.all([first, second]);
    const before = git.calls.length;
    await checker.openSpecBranches("/repos/aide", false);
    expect(git.calls.length).toBe(before);
  });

  test("a fresh call is unaffected by an in-flight non-fresh call", async () => {
    const git = gatedGit();
    const checker = new BranchStatusChecker({ run: git.run });
    const nonFresh = checker.openSpecBranches("/repos/aide", false);
    const fresh = checker.openSpecBranches("/repos/aide", true);
    git.release();
    await Promise.all([nonFresh, fresh]);
    expect(git.calls.length).toBe(2);
  });
});

// The landing deletes the branch on origin, and until something asks git
// again this checker still holds the answer from before. Every reader of
// `peekOpenSpecBranches` — the archived row above all — then reports the
// spec that was just archived as "its branch is still on origin — re-run
// archive". The landing's own `fresh` re-check corrects it, but not until
// the whole merge loop is over; this closes the window at the delete
// itself (2026-09-09).
describe("BranchStatusChecker.forgetOpenSpecBranch", () => {
  const LISTED_TWO =
    "a3f9c21deadbeef0000000000000000000000000\trefs/heads/aide/191-one-answer\n" +
    "b7e1d05feedface0000000000000000000000000\trefs/heads/aide/178-nobody-waits\n";

  async function warm(): Promise<{ checker: BranchStatusChecker; calls: number }> {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED_TWO } });
    const checker = new BranchStatusChecker({ run: git.run });
    await checker.openSpecBranches("/repos/aide");
    return { checker, calls: git.calls.length };
  }

  test("takes the branch out of the cached set, leaving the others", async () => {
    const { checker } = await warm();
    checker.forgetOpenSpecBranch("/repos/aide", "aide/191-one-answer");
    const peek = checker.peekOpenSpecBranches("/repos/aide");
    expect([...peek.open!]).toEqual(["aide/178-nobody-waits"]);
  });

  test("leaves checkedAt where it was: origin was not asked again", async () => {
    const { checker } = await warm();
    const before = checker.peekOpenSpecBranches("/repos/aide").checkedAt;
    checker.forgetOpenSpecBranch("/repos/aide", "aide/191-one-answer");
    expect(checker.peekOpenSpecBranches("/repos/aide").checkedAt).toBe(before);
  });

  test("asks git nothing", async () => {
    const { checker, calls } = await warm();
    checker.forgetOpenSpecBranch("/repos/aide", "aide/191-one-answer");
    // `warm()` counted the one ls-remote; nothing may have been added.
    expect(calls).toBe(1);
  });

  test("a root nobody has asked about is left unanswered, not turned into an empty set", () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: LISTED_TWO } });
    const checker = new BranchStatusChecker({ run: git.run });
    checker.forgetOpenSpecBranch("/repos/never-asked", "aide/191-one-answer");
    // Still `null`, which every caller reads as "claim nothing" — an
    // empty set here would report every archived spec as landed.
    expect(checker.peekOpenSpecBranches("/repos/never-asked").open).toBeNull();
  });

  test("a branch that was not in the set changes nothing", async () => {
    const { checker } = await warm();
    checker.forgetOpenSpecBranch("/repos/aide", "aide/999-never-existed");
    expect(checker.peekOpenSpecBranches("/repos/aide").open!.size).toBe(2);
  });
});
