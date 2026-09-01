// Spec 310: every spec file can be edited, not only the description.
// The Analysis, Solution and Status tabs gain the same Save the
// Description tab has always had (REQ-1), the save route now takes
// `file` as part of the request (REQ-2), the staleness guard is per
// file (REQ-3), and a save onto a spec with an open `aide/<folder>`
// branch writes onto that branch — Description's own save included
// (REQ-4). Split out of spec-edit-save-and-misc.test.ts, whose own
// suite stays about the Description tab's save path.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../src/git/branch-status.ts";
import {
  TOKEN, SPEC, PAGE, ANALYSIS_TAB, SOLUTION_TAB, STATUS_TAB, DESCRIPTION, FILE_SHA,
  createSpecSaveHarness, fillAnalysisAndSolution, specFilePath, descriptionPath, savable, post,
  ARCHIVED, ARCHIVED_TEXT, archivedDescriptionPath,
} from "./spec-save-fixtures.ts";
import { branchAwareGitRunner, BRANCH_FILE_SHA } from "./spec-checks-fixtures.ts";

const { harness, start, startArchived } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

// --- REQ-1: a Save on Analysis, Solution and Status ------------------------

describe("POST the Save action on the newly-editable tabs (REQ-1)", () => {
  for (const [tab, file, tabPath] of [
    ["analysis", "2-analysis.md", ANALYSIS_TAB],
    ["solution", "3-solution.md", SOLUTION_TAB],
    ["status", "4-status.md", STATUS_TAB],
  ] as const) {
    test(`${tab}: writes the file, commits it, pushes it and returns to the tab`, async () => {
      const { base, dir } = start(savable("/host"));
      fillAnalysisAndSolution(dir);
      const res = await post(base, { text: "new text\n", baseSha: FILE_SHA, file });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(tabPath)).toBe(true);
      expect(location).not.toContain("error=");
      expect(readFileSync(specFilePath(dir, file), "utf-8")).toBe("new text\n");
    });

    test(`${tab}: a stale baseSha is refused, and nothing is written`, async () => {
      const { base, dir } = start(savable("/host"));
      fillAnalysisAndSolution(dir);
      const before = readFileSync(specFilePath(dir, file), "utf-8");
      const res = await post(base, { text: "new text\n", baseSha: "0000000ffffff", file });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(tabPath)).toBe(true);
      expect(location).toContain("changed since");
      expect(readFileSync(specFilePath(dir, file), "utf-8")).toBe(before);
    });
  }
});

// --- REQ-2: the file comes in with the request, and is checked against -----
// --- the allowlist -----------------------------------------------------------

describe("the save route's own file allowlist (REQ-2)", () => {
  for (const bad of ["0-README.md", "../../etc/passwd", "5-nonexistent.md"]) {
    test(`a file outside the four editable files is refused before any write: ${bad}`, async () => {
      const { base, dir } = start(savable("/host"));
      const res = await post(base, { text: "x", baseSha: FILE_SHA, file: bad });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(PAGE)).toBe(true);
      expect(location).toContain("unknown spec file");
      expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    });
  }

  test("a request with no file field at all still defaults to the description", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await post(base, { text: "new description\n", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe("new description\n");
  });
});

// --- REQ-3: the staleness guard is per file, not global --------------------

describe("the staleness guard is per file (REQ-3)", () => {
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
    const res = await post(base, { text: "new solution\n", baseSha: SOLUTION_SHA, file: "3-solution.md" });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toBe("new solution\n");
  });

  test("the file's OWN commit having moved still refuses it", async () => {
    const { base, dir } = start(perFileGitRun("/host"));
    fillAnalysisAndSolution(dir);
    const res = await post(base, { text: "new solution\n", baseSha: ANALYSIS_SHA, file: "3-solution.md" });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("changed since");
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toContain("One must-fix.");
  });
});

// --- REQ-4: a save onto a spec with an open branch writes onto it, ---------
// --- Description's own save included ----------------------------------------

describe("a save writes onto the spec's own open branch when one exists (REQ-4)", () => {
  test("solution: the commit lands on refs/heads/aide/<folder>, never on main", async () => {
    const { run, calls } = branchAwareGitRunner({ file: "3-solution.md", open: true, branchText: "old solution\n" });
    const { base, dir } = start(run);
    fillAnalysisAndSolution(dir);
    const res = await post(base, { text: "new solution\n", baseSha: BRANCH_FILE_SHA, file: "3-solution.md" });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
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
    const res = await post(base, { text: "new description\n", baseSha: BRANCH_FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
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
    const res = await post(base, { text: "new solution\n", baseSha: BRANCH_FILE_SHA, file: "3-solution.md" });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("changed on origin while this was being saved");
  });

  test("with no open branch, a save writes onto main exactly as before (REQ-2's untouched path)", async () => {
    const { run } = branchAwareGitRunner({ file: "3-solution.md", open: false });
    const { base, dir } = start(run);
    fillAnalysisAndSolution(dir);
    const res = await post(base, { text: "new solution\n", baseSha: FILE_SHA, file: "3-solution.md" });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toBe("new solution\n");
  });
});

// --- REQ-5: an archived spec stays read-only on every tab -------------------

describe("Save against an archived spec is refused on every tab (REQ-5)", () => {
  for (const file of ["2-analysis.md", "3-solution.md", "4-status.md"] as const) {
    test(`${file}: writes nothing, and says why on the spec's own page`, async () => {
      const { base, dir } = startArchived(savable("/host"));
      const res = await post(
        base,
        { text: "new text\n", baseSha: FILE_SHA, file },
        `/api/queue/specs/aide/${ARCHIVED}/save`,
      );
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location).toContain("error=");
      expect(location).toContain("archived");
      expect(readFileSync(archivedDescriptionPath(dir), "utf-8")).toBe(ARCHIVED_TEXT);
    });
  }
});

// --- REQ-6: a queued or running job gates a save on every tab --------------

describe("a queued job gates a save on the newly-editable tabs too (REQ-6)", () => {
  test("solution: refused with the same wording the tick route already gives", async () => {
    const { base, dir } = start(savable("/host"));
    fillAnalysisAndSolution(dir);
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"] }),
    });
    expect(queued.status).toBe(200);
    const res = await post(base, { text: "new solution\n", baseSha: FILE_SHA, file: "3-solution.md" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("another job for this spec is still running");
    expect(readFileSync(specFilePath(dir, "3-solution.md"), "utf-8")).toContain("One must-fix.");
  });
});
