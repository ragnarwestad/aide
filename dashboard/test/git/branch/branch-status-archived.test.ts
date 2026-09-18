// Spec 351: whether a dependency is DONE — its folder under archive/ on
// origin's default branch — not whether its branch happens to be merged
// or gone. Every git call is injected, the same way isMerged's own suite
// (branch-status-is-merged.test.ts) asks about the LOGIC rather than a
// real repository.

import { describe, expect, test } from "bun:test";
import { BranchStatusChecker, type GitRunner } from "../../../src/git/branch-status.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const SYMREF_MASTER = {
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/master\n" },
};

/** Runs `fn` with the log line an unanswered check writes kept out of
 *  the test output. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = real;
  }
}

describe("BranchStatusChecker.archivedOnOrigin", () => {
  test("the folder found under archive/ on origin's default branch is archived", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, fetch: { code: 0 }, "cat-file -e": { code: 0 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.archivedOnOrigin("/specs", "80-dependency")).toBe(true);
    const catFile = git.calls.find((c) => c.args[0] === "cat-file")!;
    expect(catFile.args).toEqual([
      "cat-file", "-e", "refs/remotes/origin/master:./archive/80-dependency",
    ]);
    expect(catFile.dir).toBe("/specs");
  });

  test("a folder origin does not have under archive/ is not archived", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, fetch: { code: 0 }, "cat-file -e": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await checker.archivedOnOrigin("/specs", "80-dependency")).toBe(false);
  });

  test("an unreachable origin answers 'not confirmed either way', never 'not archived'", async () => {
    const git = fakeGit({ ...SYMREF_MASTER, fetch: { code: 128 }, "cat-file -e": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await quiet(() => checker.archivedOnOrigin("/specs", "80-dependency"))).toBeNull();
    // Never reads a tree it could not freshly fetch.
    expect(git.calls.some((c) => c.args[0] === "cat-file")).toBe(false);
  });

  test("no resolvable default branch is not confirmed either", async () => {
    const git = fakeGit({ "symbolic-ref": { code: 128 }, "show-ref": { code: 1 } });
    const checker = new BranchStatusChecker({ run: git.run });
    expect(await quiet(() => checker.archivedOnOrigin("/specs", "80-dependency"))).toBeNull();
    expect(git.calls.some((c) => c.args[0] === "fetch")).toBe(false);
  });

  test("a runner that throws is not confirmed either, not a crash", async () => {
    const run: GitRunner = async () => {
      throw new Error("no such directory");
    };
    const checker = new BranchStatusChecker({ run });
    const logged: string[] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    try {
      expect(await checker.archivedOnOrigin("/gone", "80-dependency")).toBeNull();
    } finally {
      console.error = real;
    }
    // Said, since nothing else would: the hold that follows is otherwise
    // a job waiting for no reason anyone can see.
    expect(logged.some((l) => l.includes("80-dependency") && l.includes("no such directory"))).toBe(true);
  });

  test("asks every time, archived or not — no TTL cache the way isMerged has", async () => {
    let found = 1; // not archived
    const run: GitRunner = async (_dir, args) => {
      if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (args[0] === "fetch") return { code: 0, stdout: "" };
      if (args[0] === "cat-file") return { code: found, stdout: "" };
      return { code: 0, stdout: "" };
    };
    const checker = new BranchStatusChecker({ run });
    expect(await checker.archivedOnOrigin("/specs", "80-dependency")).toBe(false);
    found = 0; // archived now, no clock, no `fresh` flag needed
    expect(await checker.archivedOnOrigin("/specs", "80-dependency")).toBe(true);
  });
});
