// `archive` is the one step that sends code to a default branch. An
// analyze run brings the spec's branch up to date with main in every
// repo it touches, so on a spec whose code branch already holds
// implement's work, that catch-up MOVED the code branch — and the
// analyze landing merged it, putting unarchived code on main. Rare
// while analyze could not run again on an implemented spec; an ordinary
// path once a spec held back on its checks could take another round.
// Analyze, reopen and reset land the specs repo alone now. Where the
// specs live inside the code repo, that repo lands the spec's own folder
// and nothing else of the branch — and so does a close there, whose
// folder move went with the deleted branch (paceup:03, 2026-09-18).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landClosedSpec, landStepBranch } from "../../../src/serve/land-branch";
import { BRANCH, landCtx, landingGit } from "./landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "479-spec" };

async function landAnalyze(codeRoot: string, specsRoot: string, pushed: string[]) {
  return (await analyzeCalls(codeRoot, specsRoot, pushed))
    .filter((c) => c.args.join(" ").startsWith("merge -q"))
    .map((c) => c.dir);
}

async function analyzeCalls(codeRoot: string, specsRoot: string, pushed: string[]) {
  const git = landingGit();
  const { ctx } = landCtx(git.run, {
    machineryProjectDir: () => codeRoot,
    machinerySpecsRoot: () => specsRoot,
  });
  await landStepBranch(
    ctx as unknown as Parameters<typeof landStepBranch>[0],
    JOB as unknown as Parameters<typeof landStepBranch>[1],
    "analyze",
    { branch: BRANCH, branchUrls: pushed.map((root) => ({ root, url: "" })) },
  );
  return git.calls;
}

/** Whether the calls merged the branch itself, rather than copying the
 *  spec's own paths off it. */
const mergedTheBranch = (calls: { args: string[] }[]): boolean =>
  calls.some((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`));
const copiedTheSpec = (calls: { args: string[] }[]): boolean =>
  calls.some((c) => c.args[0] === "diff" && c.args.includes(`specs/${JOB.specFolder}`));

describe("an analyze landing", () => {
  test("merges the specs repo and never the code repo beside it", async () => {
    const base = mkdtempSync(join(tmpdir(), "aide-analyze-land-"));
    const code = join(base, "code");
    const specs = join(base, "specs");
    mkdirSync(code);
    mkdirSync(join(specs, "aide"), { recursive: true });
    const merged = await landAnalyze(code, join(specs, "aide"), [specs, code]);
    expect(merged.some((dir) => dir === specs)).toBe(true);
    expect(merged.some((dir) => dir === code)).toBe(false);
  });

  test("with the specs inside the code repo, only the spec's folder lands from it", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-analyze-land-inproject-"));
    mkdirSync(join(code, "specs"), { recursive: true });
    const calls = await analyzeCalls(code, join(code, "specs"), [code]);
    expect(copiedTheSpec(calls)).toBe(true);
    expect(mergedTheBranch(calls)).toBe(false);
  });
});

describe("a close landing with the specs inside the code repo", () => {
  test("lands the spec's folder before the branch is deleted", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-close-land-inproject-"));
    mkdirSync(join(code, "specs"), { recursive: true });
    const git = landingGit();
    const { ctx } = landCtx(git.run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => join(code, "specs"),
      testServers: { stop: async () => {}, get: () => undefined, list: () => [] },
    });
    await landClosedSpec(
      ctx as unknown as Parameters<typeof landClosedSpec>[0],
      JOB as unknown as Parameters<typeof landClosedSpec>[1],
      { branch: BRANCH, terminalReason: "closed", branchUrls: [{ root: code, url: "" }] },
    );
    const copied = git.calls.findIndex((c) => c.args[0] === "diff" && c.args.includes(`specs/${JOB.specFolder}`));
    const deleted = git.calls.findIndex((c) => c.args.join(" ").startsWith("push -q origin --delete"));
    expect(copied).toBeGreaterThanOrEqual(0);
    expect(deleted).toBeGreaterThan(copied);
  });
});
