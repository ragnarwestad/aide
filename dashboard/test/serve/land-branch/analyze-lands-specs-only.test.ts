// `archive` is the one step that sends code to a default branch. An
// analyze run brings the spec's branch up to date with main in every
// repo it touches, so on a spec whose code branch already holds
// implement's work, that catch-up MOVED the code branch — and the
// analyze landing merged it, putting unarchived code on main. Rare
// while analyze could not run again on an implemented spec; an ordinary
// path once a spec held back on its checks could take another round.
// Analyze, reopen and reset land the specs repo alone now, unless the
// specs live inside the code repo, where there is no other to land.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landStepBranch } from "../../../src/serve/land-branch/steps.ts";
import { BRANCH, landCtx, landingGit } from "./landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "479-spec" };

async function landAnalyze(codeRoot: string, specsRoot: string, pushed: string[]) {
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
  return git.calls
    .filter((c) => c.args.join(" ").startsWith("merge -q"))
    .map((c) => c.dir);
}

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

  test("with the specs inside the code repo, that repo is still the one it lands", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-analyze-land-inproject-"));
    mkdirSync(join(code, "specs"), { recursive: true });
    const merged = await landAnalyze(code, join(code, "specs"), [code]);
    expect(merged).toContain(code);
  });
});
