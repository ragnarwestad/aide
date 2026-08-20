// Spec 89: the dashboard's first WRITE path. Everything before it only
// ever asked git a question; this merges a spec branch into a repo's
// default branch and pushes the result.
//
// Every git call is injected, so the suite spawns no subprocess. What it
// proves is the DECISION: which commands run, in which order, and which
// ones are never reached — a conflict aborted rather than left
// half-merged, a push failure reported rather than rolled back, and
// (spec 144) an unrelated dirty file in the checkout deciding nothing
// at all.
//
// What it cannot prove is that a real working tree ends up clean after
// `merge --abort`: no git process runs here. That half rests on
// `merge --abort` being ordinary git behaviour, and on the same
// abort-on-conflict shape already running in production inside
// `aide-run-spec` (2-analysis.md, "the merge shape to reuse").

import { describe, expect, test } from "bun:test";
import { mergeBranchIntoDefault } from "../src/branch-merge.ts";
import { fakeGit, CLEAN_MASTER, type GitCall } from "./helpers/fake-git.ts";

const BRANCH = "aide/89-merge-from-the-dashboard";
const ROOT = "/repos/aide";

/** The whole argv of every call, in order — the sequence is the thing
 *  under test, not any single command. */
const argv = (calls: GitCall[]): string[] => calls.map((c) => c.args.join(" "));

const ran = (calls: GitCall[], prefix: string): boolean =>
  argv(calls).some((a) => a.startsWith(prefix));

describe("mergeBranchIntoDefault: the happy paths", () => {
  test("a fast-forward merge is pushed, and no real merge is attempted", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(argv(git.calls)).toContain(`merge -q --ff-only refs/remotes/origin/${BRANCH}`);
    // The real merge is the FALLBACK. Running it anyway would make a
    // merge commit nobody asked for on every clean case.
    expect(ran(git.calls, "merge -q --no-edit")).toBe(false);
    expect(argv(git.calls)).toContain("push -q origin master");
  });

  test("a base that has moved on gets a real merge, and that is pushed too", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(argv(git.calls)).toContain(`merge -q --no-edit refs/remotes/origin/${BRANCH}`);
    expect(ran(git.calls, "merge --abort")).toBe(false);
  });

  // The dashboard host is not the machine `aide-run-spec` ran on, so a
  // LOCAL <branch> ref may be absent or stale. The remote-tracking ref
  // is the one `isMerged()` already trusts, and the fetch is what makes
  // it current.
  test("it merges the fetched remote-tracking ref, never a local branch", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(argv(git.calls)).toContain(`fetch --quiet origin master ${BRANCH}`);
    expect(argv(git.calls).some((a) => a === `merge -q --ff-only ${BRANCH}`)).toBe(false);
  });

  // Spec 144: whoever left work uncommitted in this checkout owns that
  // problem; it is no reason to stop a merge for everyone else. The
  // three commands that follow only write files that differ between the
  // commits, so an unrelated dirty file is untouched either way — and a
  // dirty file that DOES collide raises git's own error rather than a
  // guess made in advance.
  test("an unrelated dirty file does not stop the merge, and is not even asked about", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "status --porcelain": { code: 0, stdout: " M src/serve.ts\n" },
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(argv(git.calls)).toContain("push -q origin master");
    // The question is not asked at all — a status nobody acts on is a
    // git process per repo per press, for nothing.
    expect(ran(git.calls, "status")).toBe(false);
  });

  test("a repo with no upstream on its default branch skips the pull and still merges", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 128 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(ran(git.calls, "pull")).toBe(false);
  });
});

describe("mergeBranchIntoDefault: the refusals", () => {
  test("a conflict aborts the merge and names the repo — no half-merged tree is left", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1 },
      "merge --abort": { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
    expect(result.error).toContain("conflict");
    expect(argv(git.calls)).toContain("merge --abort");
    // Nothing is published from a merge that did not happen.
    expect(ran(git.calls, "push")).toBe(false);
    // Spec 106: the sentence above is for a person to read, and it is
    // joined with every other repo's before the page sees it. What the
    // page GATES on is this field — set at exactly one refusal, so the
    // Resolve control cannot be offered for a refusal resolving would
    // not fix.
    expect(result.reason).toBe("conflict");
  });

  test("a base that cannot be fast-forwarded is refused rather than merged over", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 1 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
    expect(ran(git.calls, "merge")).toBe(false);
    // Spec 96, criterion 16: a real divergence says nothing about
    // `index.lock`, so it is refused on the FIRST attempt. The retry
    // added for the lock must not become a general "try every pull
    // twice", which would double the wait before every honest refusal.
    expect(argv(git.calls).filter((a) => a.startsWith("pull"))).toHaveLength(1);
  });

  test("a checkout that will not switch to the base is refused", async () => {
    const git = fakeGit({ ...CLEAN_MASTER, fetch: { code: 0 }, switch: { code: 1 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("master");
    expect(ran(git.calls, "merge")).toBe(false);
  });

  test("a git that throws is a refusal, not a crash", async () => {
    const result = await mergeBranchIntoDefault(
      async () => {
        throw new Error("not a git repository");
      },
      ROOT,
      BRANCH,
      "master",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
  });
});

describe("mergeBranchIntoDefault: a push that does not reach origin", () => {
  // `isMerged()` only trusts remote-tracking refs, so a local-only merge
  // still reads as unmerged. Reported plainly — and NEVER rolled back:
  // `aide-run-spec`'s own precedent is that a push problem is not a
  // reason to undo committed work.
  test("the merge already happened, so it is reported and left alone", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 1 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("merged locally");
    expect(result.error).toContain(ROOT);
    expect(ran(git.calls, "reset")).toBe(false);
    expect(ran(git.calls, "merge --abort")).toBe(false);
  });
});

// --- spec 96: index.lock is not a conflict -----------------------------------

// Three times on 2026-08-18 the button refused with "cannot fast-forward
// main — merge it by hand" because a starting run was pulling the same
// checkout in the same second. A lost race against a courtesy pull and a
// base that genuinely diverged produced the identical refusal, because
// the only thing that tells them apart — git's own stderr — was thrown
// away before anyone could read it.
describe("mergeBranchIntoDefault: a pull that lost the race for index.lock", () => {
  const LOCK = "fatal: Unable to create '/repos/aide/.git/index.lock': File exists.";

  /** fakeGit answers the same way for every call to a prefix, so a
   *  "fails, then succeeds" case needs a runner that counts — the same
   *  closure-over-local-state shape queue-routes.test.ts already uses
   *  for its own call-count-dependent mock. */
  function pullFailing(times: number, stderr: string) {
    let pulls = 0;
    const calls: GitCall[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("pull")) {
        pulls++;
        return pulls <= times ? { code: 1, stdout: "", stderr } : { code: 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    return { run, calls, pulls: () => pulls };
  }

  test("it is retried, and the merge goes through once the lock clears (criterion 15)", async () => {
    const git = pullFailing(1, LOCK);
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(git.pulls()).toBe(2);
    expect(argv(git.calls)).toContain("push -q origin master");
  });

  test("a lock that never clears is still refused, not retried forever (criterion 15)", async () => {
    const git = pullFailing(99, LOCK);
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
    // Bounded: a stuck lock costs a fraction of a second, not the
    // request. The count is the bound, stated once.
    expect(git.pulls()).toBeLessThanOrEqual(3);
    expect(ran(git.calls, "merge")).toBe(false);
  });

  test("a pull failing for any other reason is refused at once (criterion 16)", async () => {
    const git = pullFailing(1, "fatal: Not possible to fast-forward, aborting.");
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(git.pulls()).toBe(1);
    expect(ran(git.calls, "merge")).toBe(false);
  });
});

// --- spec 99: a merged branch is gone, and a gone branch is not a conflict ---

// Spec 92's dependency guard asks origin directly whether a branch is
// still there, so a merged branch left on origin reads as "not merged
// yet" and refused a dependent spec three times on 2026-08-18. Deleting
// it is what removes that false signal — and the deletion is a cleanup
// step, never a reason to call a landed merge a failure.
describe("mergeBranchIntoDefault: the branch is deleted on origin afterwards", () => {
  const OK_TABLE = {
    ...CLEAN_MASTER,
    "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
    pull: { code: 0 },
    switch: { code: 0 },
    fetch: { code: 0 },
  };

  test("a fast-forward merge deletes the branch and stays ok (criterion 3)", async () => {
    const git = fakeGit({ ...OK_TABLE, "merge -q --ff-only": { code: 0 }, push: { code: 0 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(argv(git.calls)).toContain(`push -q origin --delete ${BRANCH}`);
    // Order matters: the base reaches origin first, so a deletion that
    // races anything never removes work that has not landed.
    expect(argv(git.calls).indexOf("push -q origin master")).toBeLessThan(
      argv(git.calls).indexOf(`push -q origin --delete ${BRANCH}`),
    );
  });

  test("a real merge deletes the branch too (criterion 3)", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 0 },
      push: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(argv(git.calls)).toContain(`push -q origin --delete ${BRANCH}`);
  });

  test("a deletion that fails is reported and never unmerges the merge (criterion 4)", async () => {
    // The push of the base succeeds; only the deletion is refused.
    const calls: GitCall[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("push -q origin --delete")) {
        return { code: 1, stdout: "", stderr: "remote: refusing to delete the current branch\n" };
      }
      return { code: 0, stdout: "" };
    };
    const result = await mergeBranchIntoDefault(run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.branchDeleteError).toContain(BRANCH);
    expect(result.branchDeleteError).toContain("refusing to delete");
  });

  test("a merge that never happened deletes nothing", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1 },
      "merge --abort": { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(ran(git.calls, "push")).toBe(false);
  });
});

// Deleting the branch on merge means the button will one day be pressed
// on a branch that is already gone — by a second click, or by someone
// who removed it by hand. Attempting the merge against an unresolvable
// ref reported it as a conflict, which is a different problem with a
// different remedy.
describe("mergeBranchIntoDefault: the branch is not on origin", () => {
  test("it is refused by name, and never called a conflict (criterion 5)", async () => {
    const git = fakeGit({ ...CLEAN_MASTER, "ls-remote": { code: 2 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(BRANCH);
    expect(result.error).toContain("not on origin");
    expect(result.error).not.toContain("conflict");
  });

  // Spec 129: 54 of the 75 refusals in the log were this one, across 23
  // specs — a row offering a button for a branch that was not on origin
  // any more. The sentence alone cannot fix that: `isMerged()` caches
  // for 30 seconds, so the row goes on offering the same doomed press
  // until the TTL runs out. This field is what lets the merge route
  // correct the cache it just proved wrong.
  test("it says GONE, so the caller can correct the cache it just disproved (criterion 4)", async () => {
    const git = fakeGit({ ...CLEAN_MASTER, "ls-remote": { code: 2 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.reason).toBe("gone");
  });

  test("nothing beyond the two questions is run (criterion 5)", async () => {
    const git = fakeGit({ ...CLEAN_MASTER, "ls-remote": { code: 2 } });
    await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(ran(git.calls, "switch")).toBe(false);
    expect(ran(git.calls, "merge")).toBe(false);
    expect(ran(git.calls, "push")).toBe(false);
    expect(ran(git.calls, "fetch")).toBe(false);
  });

  test("an ls-remote that fails for any other reason merges as before (criterion 5)", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "ls-remote": { code: 128 },
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
  });
});

// --- spec 106/129: the field names only the refusals a machine acts on -------
//
// The Resolve control is offered on the strength of this
// one field, so a refusal that a resolve step could not fix must never
// be called a conflict. Spec 129 added the second, and only the second:
// `"gone"`, which the merge route reads to invalidate the branch-status
// cache. Each of the others below is a refusal the merge route already
// knows how to produce, and no machine has anything to do about any of
// them — they carry nothing.

describe("mergeBranchIntoDefault: reason is set at exactly two refusals", () => {
  test("a branch that is not on origin is called gone, and never a conflict", async () => {
    const git = fakeGit({ ...CLEAN_MASTER, "ls-remote": { code: 2 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("gone");
  });

  // Spec 129: the other 21 refusals in the log, across 7 specs. Every
  // one of them had to be finished by hand, and nobody ever saw why —
  // the reason went to the log and nowhere else. Nothing here needs a
  // code path of its own: this sentence is what the row shows, once the
  // client stops letting a stale swap wipe it. So the sentence itself
  // is pinned, and the field stays empty — no machine can finish this
  // one, and offering a resolve step for it would be a lie.
  test("a base that cannot be fast-forwarded says so in full, and carries no reason", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 1 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toBe(`cannot fast-forward master in ${ROOT} — merge it by hand`);
    expect(result.reason).toBeUndefined();
  });

  test("a push that failed carries no reason — the merge itself went through", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 1 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  test("a merge that went through carries no reason either", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      pull: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
