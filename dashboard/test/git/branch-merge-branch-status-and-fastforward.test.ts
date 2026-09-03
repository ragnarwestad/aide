// Split out of branch-merge.test.ts by theme.
//
// Spec 89: the dashboard's first WRITE path — merges a spec branch into
// a repo's default branch and pushes the result. Every git call is
// injected, so the suite spawns no subprocess.

import { describe, expect, test } from "bun:test";
import { fastForwardToOrigin, mergeBranchIntoDefault } from "../../src/git/branch-merge.ts";
import { fakeGit, CLEAN_MASTER, type GitCall } from "../helpers/fake-git.ts";

const BRANCH = "aide/89-merge-from-the-dashboard";
const ROOT = "/repos/aide";
const noWait = async (_ms: number): Promise<void> => {};

/** The whole argv of every call, in order — the sequence is the thing
 *  under test, not any single command. */
const argv = (calls: GitCall[]): string[] => calls.map((c) => c.args.join(" "));

const ran = (calls: GitCall[], prefix: string): boolean =>
  argv(calls).some((a) => a.startsWith(prefix));

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

// --- spec 106/129/171: the field names only the refusals a machine acts on ---
//
// `"conflict"` is what tells a reader the branch and the default branch
// genuinely disagree, so a refusal that is NOT that must never be called
// one. It carried a Resolve control until spec 171 folded resolving into
// `archive`; the field's meaning is unchanged, the control is gone.
// Spec 129 added the second, and only the second:
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
  // one, and calling it a conflict would be a lie.
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
    expect(result.error).toBe(
      `cannot fast-forward master — merge it by hand, in the checkout on the serving host (${BRANCH} in ${ROOT})`,
    );
    expect(result.reason).toBeUndefined();
  });

  // A landing that never finished leaves base ahead of origin by commits
  // origin already holds (the branch's own, and merges of them). That
  // used to refuse every later landing in the root as "cannot
  // fast-forward"; it is a leftover, and is dropped.
  test("a base ahead of origin only by commits origin holds is reset, and the landing goes on", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "ls-remote --exit-code": { code: 0, stdout: "deadbeef\trefs/heads/aide/89-merge-from-the-dashboard\n" },
      "ls-remote origin": { code: 0 },
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      "pull -q --ff-only": [{ code: 1, stderr: "fatal: Not possible to fast-forward, aborting." }, { code: 0 }],
      "rev-list --count origin/master..master": { code: 0, stdout: "3\n" },
      "rev-list origin/master..master --no-merges --not --remotes=origin": { code: 0, stdout: "" },
      reset: { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      switch: { code: 0 },
      fetch: { code: 0 },
      checkout: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    const seq = git.calls.map((c) => c.args.join(" "));
    expect(seq.indexOf("reset -q --hard origin/master")).toBeGreaterThan(seq.indexOf("pull -q --ff-only"));
  });

  test("a base ahead of origin by a commit of its own is still refused — that is somebody's work", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "ls-remote --exit-code": { code: 0, stdout: "deadbeef\trefs/heads/aide/89-merge-from-the-dashboard\n" },
      "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
      "pull -q --ff-only": { code: 1 },
      "rev-list --count origin/master..master": { code: 0, stdout: "1\n" },
      "rev-list origin/master..master --no-merges --not --remotes=origin": { code: 0, stdout: "abc1234\n" },
      switch: { code: 0 },
      fetch: { code: 0 },
      checkout: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot fast-forward master");
    expect(git.calls.some((c) => c.args[0] === "reset")).toBe(false);
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

// Spec 258: the Deploy button's whole job — a checkout that fell behind
// because a merge landed somewhere other than this dashboard's own
// Merge button, so there is nothing to merge IN, only to fast-forward.
// Steps 2-3 of `mergeBranchIntoDefault` alone, with no feature branch.
describe("fastForwardToOrigin", () => {
  test("fetches and fast-forwards, and merges or pushes nothing", async () => {
    const git = fakeGit({
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "master\n" },
      fetch: { code: 0 },
      pull: { code: 0 },
    });
    const result = await fastForwardToOrigin(git.run, ROOT, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(argv(git.calls)).toContain("fetch --quiet origin master");
    expect(ran(git.calls, "merge")).toBe(false);
    expect(ran(git.calls, "push")).toBe(false);
  });

  test("refuses, naming both branches, when not standing on base (criterion 7)", async () => {
    const git = fakeGit({ "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "feature-x\n" } });
    const result = await fastForwardToOrigin(git.run, ROOT, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("feature-x");
    expect(result.error).toContain("master");
    expect(ran(git.calls, "fetch")).toBe(false);
    expect(ran(git.calls, "pull")).toBe(false);
  });

  test("refuses when the pull fails", async () => {
    const git = fakeGit({
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "master\n" },
      fetch: { code: 0 },
      pull: { code: 1, stderr: "fatal: Not possible to fast-forward, aborting." },
    });
    const result = await fastForwardToOrigin(git.run, ROOT, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
  });

  test("the index-lock retry: a lock that clears lets the pull through", async () => {
    let pulls = 0;
    const run = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "master\n" };
      if (a.startsWith("pull")) {
        pulls++;
        return pulls <= 1
          ? { code: 1, stdout: "", stderr: "fatal: Unable to create '/repos/aide/.git/index.lock': File exists." }
          : { code: 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    const result = await fastForwardToOrigin(run, ROOT, "master", noWait);
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(pulls).toBe(2);
  });

  test("a git that throws resolves to a refusal", async () => {
    const run = async (): Promise<never> => {
      throw new Error("no such directory");
    };
    const result = await fastForwardToOrigin(run, ROOT, "master");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
  });
});
