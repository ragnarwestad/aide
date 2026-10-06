// Whether an archived spec's open branch counts as merged: git's own
// answer, and for a project that reviews its code, GitHub's too — a squash
// merge leaves the branch outside main, and only the pull request knows it
// merged. Real temp directories and warmed caches, because `specRoots`
// drops a path that does not exist and the peek only reads what was asked.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchStatusChecker, type GitRunner } from "../../src/git/branch-status.ts";
import type { CodeLanding } from "../../src/project/discover";
import type { PullRequestAnswer } from "../../src/integrations/pull-requests.ts";
import { mergedPullRequest, peekMergedOnOrigin, type SpecLookupContext } from "../../src/serve/spec-lookup.ts";

const FOLDER = "37-the-arithmetic";
const BRANCH = `aide/${FOLDER}`;
const KEY = `aide/${FOLDER}`;

let tmp = "";
let codeRoot = "";
let outsideSpecs = "";
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "aide-merged-on-origin-"));
  codeRoot = join(tmp, "code");
  outsideSpecs = join(tmp, "specs-repo");
  mkdirSync(join(codeRoot, "specs"), { recursive: true });
  mkdirSync(outsideSpecs, { recursive: true });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Git says each root holds the branch; `notMerged` lists the roots in
 *  which it is not an ancestor of the default branch. */
function gitSaying(notMerged: string[]): GitRunner {
  return async (dir, args) => {
    if (args[0] === "ls-remote") return { code: 0, stdout: `sha\trefs/heads/${BRANCH}\n` };
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/main\n" };
    if (args[0] === "merge-base") return { code: notMerged.includes(dir) ? 1 : 0, stdout: "" };
    return { code: 0, stdout: "" };
  };
}

/** A lookup context over the real directories, its caches filled the way
 *  the sweep fills them. `specsOutside` puts the project's specs in a
 *  repository of their own. */
async function lookup(o: {
  landing: CodeLanding;
  notMerged: string[];
  answer?: PullRequestAnswer;
  specsOutside?: boolean;
}): Promise<SpecLookupContext> {
  const branchStatus = new BranchStatusChecker({ run: gitSaying(o.notMerged), ttlMs: 60_000 });
  const specs = o.specsOutside ? outsideSpecs : join(codeRoot, "specs");
  const ctx = {
    machineryProjectDir: () => codeRoot,
    machinerySpecsRoot: () => specs,
    branchStatus,
    codeLanding: () => o.landing,
    pullRequests: new Map<string, PullRequestAnswer>(o.answer ? [[KEY, o.answer]] : []),
  } as unknown as SpecLookupContext;
  for (const root of [codeRoot, specs]) {
    await branchStatus.openSpecBranches(root);
    await branchStatus.isMerged(root, BRANCH);
  }
  return ctx;
}

const MERGED: PullRequestAnswer = { merged: true, headSha: "abc" };
const everyRoot = (): string[] => [codeRoot, join(codeRoot, "specs")];

describe("a pull request that merged counts for a project that reviews its code", () => {
  test("git says not an ancestor, GitHub says merged: merged (AC-1)", async () => {
    const ctx = await lookup({ landing: "pr", notMerged: everyRoot(), answer: MERGED });
    expect(peekMergedOnOrigin(ctx, "aide", FOLDER)).toBe(true);
  });

  test("git says an ancestor, nothing from GitHub yet: merged (AC-1)", async () => {
    const ctx = await lookup({ landing: "pr", notMerged: [] });
    expect(peekMergedOnOrigin(ctx, "aide", FOLDER)).toBe(true);
  });

  test("git says not an ancestor and GitHub has no merged request: not merged (AC-2)", async () => {
    const unmerged = everyRoot();
    expect(peekMergedOnOrigin(await lookup({ landing: "pr", notMerged: unmerged, answer: { merged: false } }), "aide", FOLDER)).toBe(false);
    expect(peekMergedOnOrigin(await lookup({ landing: "pr", notMerged: unmerged }), "aide", FOLDER)).toBe(false);
  });

  test("a specs root in a repository of its own is answered by git alone (AC-1)", async () => {
    const ctx = await lookup({ landing: "pr", notMerged: [outsideSpecs], answer: MERGED, specsOutside: true });
    expect(peekMergedOnOrigin(ctx, "aide", FOLDER)).toBe(false);
    expect(mergedPullRequest(ctx, "aide", FOLDER, outsideSpecs)).toBeUndefined();
    expect(mergedPullRequest(ctx, "aide", FOLDER, codeRoot)).toEqual(MERGED);
  });
});

describe("a project that merges its code at archive reads git's answer alone", () => {
  test("a stored merged request changes nothing (AC-5)", async () => {
    const notMerged = await lookup({ landing: "merge", notMerged: everyRoot(), answer: MERGED });
    const merged = await lookup({ landing: "merge", notMerged: [], answer: MERGED });
    expect(peekMergedOnOrigin(notMerged, "aide", FOLDER)).toBe(false);
    expect(peekMergedOnOrigin(merged, "aide", FOLDER)).toBe(true);
    expect(mergedPullRequest(notMerged, "aide", FOLDER, codeRoot)).toBeUndefined();
  });
});
