// Split out of branch-merge.test.ts by theme.
//
// The dashboard's first WRITE path — merges a spec branch into
// a repo's default branch and pushes the result. Every git call is
// injected, so the suite spawns no subprocess.

import { describe, expect, test } from "bun:test";
import { mergeBranchIntoDefault } from "../../../src/git/branch-merge/index.ts";
import { fakeGit, CLEAN_MASTER, type GitCall } from "../../helpers/fake-git.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

/** What a reader would see: a message is stored as
 *  its key and the values that fill its blanks, and composed when
 *  the page is drawn. */
function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}


const BRANCH = "aide/89-merge-from-the-dashboard";
const ROOT = "/repos/aide";
const noWait = async (_ms: number): Promise<void> => {};

/** The whole argv of every call, in order — the sequence is the thing
 *  under test, not any single command. */
const argv = (calls: GitCall[]): string[] => calls.map((c) => c.args.join(" "));

const ran = (calls: GitCall[], prefix: string): boolean =>
  argv(calls).some((a) => a.startsWith(prefix));

// --- The catch-up and git's own lock ---------------------------------

// The shared checkout's catch-up runs under the runner's checkout lock,
// so a run is never in its own section while it runs: a git lock lost
// there is a failure like any other, tried once. The merge in the
// landing's own worktree is not in the shared checkout, and is retried.
describe("mergeBranchIntoDefault: the catch-up and the merge against git's own lock", () => {
  const LOCK = "fatal: Unable to create '/repos/aide/.git/index.lock': File exists.";

  function catchUpFailing(stderr: string) {
    let pulls = 0;
    const calls: GitCall[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q --ff-only origin/")) {
        pulls++;
        return { code: 1, stdout: "", stderr };
      }
      return { code: 0, stdout: "" };
    };
    return { run, calls, catchUps: () => pulls };
  }

  test("a catch-up that fails on git's index.lock is run once, and the landing stays landed (AC-3)", async () => {
    const git = catchUpFailing(LOCK);
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(git.catchUps()).toBe(1);
    expect(argv(git.calls)).toContain("push -q origin HEAD:refs/heads/master");
  });

  // The landing still succeeded, and the checkout is the only thing
  // behind — so this is said on the server's own log, not turned into a
  // refusal the reader has to act on.
  test("a catch-up that never succeeds does not refuse the landing", async () => {
    const git = catchUpFailing("fatal: Unable to create '/repos/aide/.git/packed-refs.lock': File exists.");
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(true);
    expect(argv(git.calls)).toContain("push -q origin HEAD:refs/heads/master");
  });

  test("a merge that lost a lock race is retried, and is not a conflict", async () => {
    let merges = 0;
    const calls: GitCall[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("merge -q") && a.includes("refs/remotes/")) {
        merges++;
        return merges <= 2
          ? { code: 1, stdout: "", stderr: LOCK }
          : { code: 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    const result = await mergeBranchIntoDefault(run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(argv(calls).filter((a) => a === "merge --abort")).toHaveLength(1);
  });
});

// --- A merged branch is gone, and a gone branch is not a conflict ---

/** What every call before the merge itself answers when the checkout is
 *  clean and up to date — the table the two cleanup blocks below both
 *  build their cases on. */
const OK_TABLE = {
  ...CLEAN_MASTER,
  "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
  pull: { code: 0 },
  switch: { code: 0 },
  fetch: { code: 0 },
};

// The dependency guard asks origin directly whether a branch is
// still there, so a merged branch left on origin reads as "not merged
// yet" and refused a dependent spec three times on 2026-08-18. Deleting
// it is what removes that false signal — and the deletion is a cleanup
// step, never a reason to call a landed merge a failure.
describe("mergeBranchIntoDefault: the branch is deleted on origin afterwards", () => {
  test("a fast-forward merge deletes the branch and stays ok", async () => {
    const git = fakeGit({ ...OK_TABLE, "merge -q --ff-only": { code: 0 }, push: { code: 0 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(argv(git.calls)).toContain(`push -q origin --delete ${BRANCH}`);
    // Order matters: the base reaches origin first, so a deletion that
    // races anything never removes work that has not landed.
    expect(argv(git.calls).indexOf("push -q origin HEAD:refs/heads/master")).toBeLessThan(
      argv(git.calls).indexOf(`push -q origin --delete ${BRANCH}`),
    );
  });

  test("a real merge deletes the branch too", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 0 },
      push: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(argv(git.calls)).toContain(`push -q origin --delete ${BRANCH}`);
  });

  test("a deletion that fails is reported and never unmerges the merge", async () => {
    // The push of the base succeeds; only the deletion is refused.
    const run = async (_dir: string, args: string[]) => {
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
    expect(sentence(result.branchDeleteError)).toContain(BRANCH);
    // git's own stderr rides in `detail`, never in the
    // sentence itself.
    expect(sentence(result.branchDeleteError)).not.toContain("refusing to delete");
    expect(result.detail).toContain("refusing to delete");
  });

  test("a merge that never happened deletes nothing", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1 },
      "merge --abort": { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(ran(git.calls, "push")).toBe(false);
  });
});

// --- The checkout's own copy goes at the same moment --------------
//
// The branch a run makes outlives the worktree that made it: a worktree
// is thrown away when the run ends, the ref it created is not. Nothing
// ever removed one, and 260 had piled up by 2026-08-23 — and one of them
// was still there to be picked up when a spec was reopened, carrying a
// conflict with a main that had moved on. So the landing deletes both
// copies, or neither.
describe("mergeBranchIntoDefault: the branch is deleted locally too", () => {
  test("a fast-forward merge deletes the local branch as well as origin's", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      "branch -d": { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
    expect(argv(git.calls)).toContain(`branch -d ${BRANCH}`);
    // After origin's, never before: the origin delete is the one that
    // can still fail, and a local ref removed ahead of it would be the
    // only copy lost.
    expect(argv(git.calls).indexOf(`push -q origin --delete ${BRANCH}`)).toBeLessThan(
      argv(git.calls).indexOf(`branch -d ${BRANCH}`),
    );
  });

  test("a real merge deletes the local branch too", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 0 },
      push: { code: 0 },
      "branch -d": { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(argv(git.calls)).toContain(`branch -d ${BRANCH}`);
  });

  test("an origin delete that fails never touches the local branch", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 0 },
      "push -q origin --delete": { code: 1, stderr: "remote: refusing\n" },
      push: { code: 0 },
      "branch -d": { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(true);
    expect(sentence(result.branchDeleteError)).toContain(BRANCH);
    // "In both places, or in neither": origin still has it, so this
    // checkout keeps its copy too.
    expect(ran(git.calls, "branch -d")).toBe(false);
  });

  test("a local branch that cannot be deleted never turns a landed merge into a failure", async () => {
    const git = fakeGit({
      ...OK_TABLE,
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 0 },
      push: { code: 0 },
      "branch -d": { code: 1, stderr: "error: branch not found\n" },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result).toEqual({ root: ROOT, ok: true });
  });
});
