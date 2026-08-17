// Spec 89: the dashboard's first WRITE path. Everything before it only
// ever asked git a question; this merges a spec branch into a repo's
// default branch and pushes the result.
//
// Every git call is injected, so the suite spawns no subprocess. What it
// proves is the DECISION: which commands run, in which order, and which
// ones are never reached — a dirty tree refused before anything could
// touch history, a conflict aborted rather than left half-merged, a
// push failure reported rather than rolled back.
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
  test("a dirty tree is refused by name, before any command that could touch history", async () => {
    const git = fakeGit({
      ...CLEAN_MASTER,
      "status --porcelain": { code: 0, stdout: " M src/serve.ts\n" },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master");
    expect(result.ok).toBe(false);
    expect(result.root).toBe(ROOT);
    expect(result.error).toContain(ROOT);
    expect(result.error).toContain("dirty");
    // Nothing beyond the question was asked.
    expect(argv(git.calls)).toEqual(["status --porcelain"]);
  });

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
