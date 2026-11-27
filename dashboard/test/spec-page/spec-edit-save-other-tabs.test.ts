// Every spec file can be edited, not only the description.
// The Analysis, Solution and Status tabs gain the same Save the
// Description tab has always had, the save route now takes
// `file` as part of the request, the staleness guard is per
// file, and a save onto a spec with an open `aide/<folder>`
// branch writes onto that branch — Description's own save included
// Split out of spec-edit-save-and-misc.test.ts, whose own
// suite stays about the Description tab's save path.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../../src/git/process/index.ts";
import { SPEC, DESCRIPTION, FILE_SHA, createSpecSaveHarness, fillAnalysisAndSolution, specFilePath, descriptionPath, savable, post, answer } from "./spec-save-fixtures.ts";
import { branchAwareGitRunner, BRANCH_FILE_SHA } from "./spec-checks-fixtures.ts";

const { harness, start } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

// --- The file comes in with the request, and is checked against -----
// --- the allowlist -----------------------------------------------------------

describe("the save route's own file allowlist", () => {
  for (const bad of ["0-README.md", "../../etc/passwd", "5-nonexistent.md"]) {
    test(`a file outside the four editable files is refused before any write: ${bad}`, async () => {
      const { base, dir } = start(savable("/host"));
      const { status, body } = await answer(await post(base, { text: "x", baseSha: FILE_SHA, file: bad }));
      expect(status).toBe(400);
      expect(body.error).toContain("unknown spec file");
      expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    });
  }
});

// --- The staleness guard is per file, not global --------------------

describe("the staleness guard is per file", () => {
  const ANALYSIS_SHA = "aaaaaaa1111111";
  const SOLUTION_SHA = "5555555bbbbbbb";

  /** Two files, each at its OWN commit — proves a save's guard reads
   *  only the file it is about. */
  const perFileGitRun = (root: string): GitRunner => {
    const base = savable(root);
    const shas: Record<string, string> = { "2-analysis.md": ANALYSIS_SHA, "3-solution.md": SOLUTION_SHA };
    return async (dir, args, timeoutMs, env) => {
      const line = args.join(" ");
      if (line.startsWith("log -1 --format=")) {
        const file = args[args.length - 1]!;
        const sha = shas[file];
        if (sha) return { code: 0, stdout: `${sha}\t2026-08-21T09:14:00+02:00\n` };
      }
      return base(dir, args, timeoutMs, env);
    };
  };

  test("a sibling file's own commit never refuses this file's save", async () => {
    const { base, dir } = start(perFileGitRun("/host"));
    fillAnalysisAndSolution(dir);
    // Solution's own sha, while Analysis sits at a completely different
    // one — the save must not care.
    const { status, body } = await answer(await post(base, { text: "new solution\n", baseSha: SOLUTION_SHA, file: "3-solution.md" }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toBe("new solution\n");
  });

  test("the file's OWN commit having moved still refuses it", async () => {
    const { base, dir } = start(perFileGitRun("/host"));
    fillAnalysisAndSolution(dir);
    const { status, body } = await answer(await post(base, { text: "new solution\n", baseSha: ANALYSIS_SHA, file: "3-solution.md" }));
    expect(status).toBe(400);
    expect(body.error).toContain("changed since");
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toContain("One must-fix.");
  });
});

// --- A save onto a spec with an open branch writes onto it, ---------
// --- Description's own save included ----------------------------------------

describe("a save writes onto the spec's own open branch when one exists", () => {
  test("solution: the commit lands on refs/heads/aide/<folder>, never on main", async () => {
    const { run, calls } = branchAwareGitRunner({ file: "3-solution.md", open: true, branchText: "old solution\n" });
    const { base, dir } = start(run);
    fillAnalysisAndSolution(dir);
    const { status, body } = await answer(await post(base, { text: "new solution\n", baseSha: BRANCH_FILE_SHA, file: "3-solution.md" }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args.some((a) => a.includes(`refs/heads/aide/${SPEC}`))).toBe(true);
    // Never the ordinary saveSpecFiles commit-onto-HEAD sequence.
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
    // main's own disk copy is untouched — the write never reached it.
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toBe("# Q - Solution\n\nOne must-fix.\n");
  });

  // The latent gap 2-analysis.md's own Codebase analysis found:
  // Description's save had the identical silent-loss bug before this
  // spec, since only the tick route was branch-aware.
  test("description: the same branch-aware write now applies to Description's own save too", async () => {
    const { run, calls } = branchAwareGitRunner({ file: "1-description.md", open: true, branchText: DESCRIPTION });
    const { base, dir } = start(run);
    const { status, body } = await answer(await post(base, { text: "new description\n", baseSha: BRANCH_FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args.some((a) => a.includes(`refs/heads/aide/${SPEC}`))).toBe(true);
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  test("a headless run's commit landing between render and Save refuses the save, not clobbers it", async () => {
    const { run } = branchAwareGitRunner({
      file: "3-solution.md", open: true, branchText: "old solution\n", pushFails: true,
    });
    const { base } = start(run);
    const { status, body } = await answer(await post(base, { text: "new solution\n", baseSha: BRANCH_FILE_SHA, file: "3-solution.md" }));
    expect(status).toBe(400);
    expect(body.error).toContain("changed on origin while this was being saved");
  });

  test("with no open branch, a save writes onto main exactly as before (the untouched path)", async () => {
    const { run } = branchAwareGitRunner({ file: "3-solution.md", open: false });
    const { base, dir } = start(run);
    fillAnalysisAndSolution(dir);
    const { status, body } = await answer(await post(base, { text: "new solution\n", baseSha: FILE_SHA, file: "3-solution.md" }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toBe("new solution\n");
  });
});
