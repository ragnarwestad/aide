// How long a cached answer about a spec stands is set in one file,
// `src/git/branch-status.ts`, and every checker that caches one reads it
// from there when it is built without a window of its own.

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVED_RESOLVED_TTL_MS, DEFAULT_TTL_MS, SCAN_TTL_MS } from "../../../src/git/branch-status.ts";
import { BranchFileStepsChecker, WorkflowHistoryChecker } from "../../../src/git/workflow-history.ts";
import {
  DescriptionFreshnessChecker, SpecCreatedAtChecker, SpecFileCommitChecker,
} from "../../../src/git/description-freshness.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const DIR = "/specs/aide/10-first";
const FOLDER = "10-first";
const TARGET: OpenBranchTarget = {
  root: "/root",
  branch: `aide/${FOLDER}`,
  relPath: `aide/specs/${FOLDER}/4-status.md`,
  archivedRelPath: `aide/specs/archive/${FOLDER}/4-status.md`,
};

describe("the windows a cached answer about a spec stands for", () => {
  test("every one is defined in branch-status.ts, and nowhere else (AC-5)", () => {
    const src = join(import.meta.dir, "../../../src");
    const defined = [...new Glob("**/*.ts").scanSync(src)]
      .filter((file) => /\b[A-Z_]+_TTL_MS\s*=/.test(readFileSync(join(src, file), "utf-8")))
      .sort();
    expect(defined).toEqual(["git/branch-status.ts"]);
    expect(readFileSync(join(src, "serve/spec-lookup.ts"), "utf-8")).toContain("SCAN_TTL_MS");
    expect([DEFAULT_TTL_MS, SCAN_TTL_MS, ARCHIVED_RESOLVED_TTL_MS].every((ms) => ms > 0)).toBe(true);
  });

  test("each checker built without a window asks git again once DEFAULT_TTL_MS has passed, and not before (AC-5)", async () => {
    let clock = 0;
    const git = fakeGit({ log: { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" } });
    const now = () => clock;
    const history = new WorkflowHistoryChecker({ run: git.run, now });
    const branch = new BranchFileStepsChecker({ run: git.run, now });
    const freshness = new DescriptionFreshnessChecker({ run: git.run, now });
    const created = new SpecCreatedAtChecker({ run: git.run, now });
    const commits = new SpecFileCommitChecker({ run: git.run, now });
    const reads: [string, () => Promise<unknown>][] = [
      ["history", () => history.read(DIR, FOLDER)],
      ["branch file steps", () => branch.read(DIR, FOLDER, TARGET)],
      ["description freshness", () => freshness.isStale(DIR, FOLDER)],
      ["created date", () => created.createdAt(DIR, FOLDER)],
      ["file commit", () => commits.commitFor(DIR, "1-description.md")],
    ];
    const askedAt = async (at: number) => {
      clock = at;
      const asked: string[] = [];
      for (const [name, read] of reads) {
        const before = git.calls.length;
        await read();
        if (git.calls.length > before) asked.push(name);
      }
      return asked;
    };
    expect(await askedAt(0)).toEqual(reads.map(([name]) => name));
    expect(await askedAt(DEFAULT_TTL_MS - 1)).toEqual([]);
    expect(await askedAt(DEFAULT_TTL_MS)).toEqual(reads.map(([name]) => name));
  });
});
