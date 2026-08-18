// Spec 97: a spec's 1-description.md can move on after `analyze` has
// run, and the row went on reading `analyze ✓` — the only person who
// knew a re-run was due was the one who made the edit.
//
// The question is asked of git, in the specs repo, because that is the
// one record that survives a worktree, a dashboard restart and a
// different machine. Everything here is answered by a fake runner: the
// rule under test is which commits are consulted and what an
// unprovable answer degrades to, never whether git works.

import { describe, expect, test } from "bun:test";
import {
  DescriptionFreshnessChecker,
  isAnalyzeStale,
  lastAnalyzeCommitAt,
  lastCommitAt,
} from "../src/description-freshness.ts";
import { fakeGit } from "./helpers/fake-git.ts";

const DIR = "/specs/aide/96-merge-button-says-what-it-merges";
const FOLDER = "96-merge-button-says-what-it-merges";
const SUBJECT = `Run /aide-analyze for ${FOLDER} (headless)`;

/** What the two lookups are keyed on: the description's own history,
 *  and the analyze commits. Kept apart so a test can move one without
 *  the other. */
const gitFor = (description: string | null, analyzeLog: string | null) =>
  fakeGit({
    "log -1 --format=%aI": description === null ? { code: 1 } : { code: 0, stdout: `${description}\n` },
    "log --format=%aI%x09%s": analyzeLog === null ? { code: 1 } : { code: 0, stdout: analyzeLog },
  });

describe("isAnalyzeStale", () => {
  test("a description committed after the analyze is stale (criterion 1)", () => {
    expect(isAnalyzeStale("2026-08-18T09:10:36+02:00", "2026-08-18T08:57:16+02:00")).toBe(true);
  });

  test("a description committed before the analyze is not (criterion 4)", () => {
    expect(isAnalyzeStale("2026-08-18T08:00:00+02:00", "2026-08-18T08:57:16+02:00")).toBe(false);
  });

  test("the same instant is not stale — strictly newer, or nothing", () => {
    expect(isAnalyzeStale("2026-08-18T08:57:16+02:00", "2026-08-18T08:57:16+02:00")).toBe(false);
  });

  // A spec analysed by hand leaves no commit to compare against. A
  // permanent badge nothing can clear is worse than no badge.
  test("either timestamp missing means not stale (criterion 8)", () => {
    expect(isAnalyzeStale(null, "2026-08-18T08:57:16+02:00")).toBe(false);
    expect(isAnalyzeStale("2026-08-18T09:10:36+02:00", null)).toBe(false);
    expect(isAnalyzeStale(null, null)).toBe(false);
  });

  test("an unparseable date is not stale rather than NaN-true", () => {
    expect(isAnalyzeStale("not a date", "2026-08-18T08:57:16+02:00")).toBe(false);
    expect(isAnalyzeStale("2026-08-18T09:10:36+02:00", "not a date")).toBe(false);
  });
});

describe("lastCommitAt", () => {
  test("returns the author date of the last commit touching the pathspec", async () => {
    const git = gitFor("2026-08-18T09:10:36+02:00", null);
    expect(await lastCommitAt(git.run, DIR, "1-description.md")).toBe("2026-08-18T09:10:36+02:00");
    // The pathspec is what keeps a plan-merge out of the answer: a
    // merge commit touches 2-analysis.md and 3-solution.md and never
    // the description (criterion 6).
    expect(git.calls[0]!.args).toEqual(["log", "-1", "--format=%aI", "--", "1-description.md"]);
    expect(git.calls[0]!.dir).toBe(DIR);
  });

  test("null when git fails or prints nothing", async () => {
    expect(await lastCommitAt(gitFor(null, null).run, DIR, "1-description.md")).toBeNull();
    const empty = fakeGit({ "log -1": { code: 0, stdout: "\n" } });
    expect(await lastCommitAt(empty.run, DIR, "1-description.md")).toBeNull();
  });
});

describe("lastAnalyzeCommitAt", () => {
  test("matches the exact success message a headless run leaves", async () => {
    const git = gitFor(null, `2026-08-18T08:57:16+02:00\t${SUBJECT}\n`);
    expect(await lastAnalyzeCommitAt(git.run, DIR, FOLDER)).toBe("2026-08-18T08:57:16+02:00");
    expect(git.calls[0]!.args).toEqual([
      "log", "--format=%aI%x09%s", "--fixed-strings", `--grep=${SUBJECT}`,
    ]);
  });

  // The sharp edge: the success message is a PREFIX of the stopped
  // one, and a fixed-string grep matches prefixes. Only the equality
  // check in JS tells the two apart.
  test("a stopped run with the same prefix is not a successful analyze (criterion 7)", async () => {
    const git = gitFor(
      null,
      [
        `2026-08-18T09:00:00+02:00\t${SUBJECT} (stopped: budget)`,
        `2026-08-18T08:00:00+02:00\t${SUBJECT}`,
      ].join("\n"),
    );
    expect(await lastAnalyzeCommitAt(git.run, DIR, FOLDER)).toBe("2026-08-18T08:00:00+02:00");
  });

  test("the newest of several re-runs wins (criterion 5)", async () => {
    const git = gitFor(
      null,
      [
        `2026-08-18T11:00:00+02:00\t${SUBJECT}`,
        `2026-08-18T08:57:16+02:00\t${SUBJECT}`,
      ].join("\n"),
    );
    expect(await lastAnalyzeCommitAt(git.run, DIR, FOLDER)).toBe("2026-08-18T11:00:00+02:00");
  });

  test("a plan-merge commit is not mistaken for an analyze (criterion 6)", async () => {
    const git = gitFor(
      null,
      [
        `2026-08-18T10:00:00+02:00\tMerge remote-tracking branch 'refs/remotes/origin/aide/${FOLDER}'`,
        `2026-08-18T08:57:16+02:00\t${SUBJECT}`,
      ].join("\n"),
    );
    expect(await lastAnalyzeCommitAt(git.run, DIR, FOLDER)).toBe("2026-08-18T08:57:16+02:00");
  });

  test("null when no analyze has ever been committed (criterion 8)", async () => {
    expect(await lastAnalyzeCommitAt(gitFor(null, "").run, DIR, FOLDER)).toBeNull();
    expect(await lastAnalyzeCommitAt(gitFor(null, null).run, DIR, FOLDER)).toBeNull();
  });

  test("another spec's analyze commit does not count as this one's", async () => {
    const git = gitFor(null, `2026-08-18T08:57:16+02:00\tRun /aide-analyze for 95-other (headless)\n`);
    expect(await lastAnalyzeCommitAt(git.run, DIR, FOLDER)).toBeNull();
  });
});

describe("DescriptionFreshnessChecker", () => {
  const stale = () =>
    gitFor("2026-08-18T09:10:36+02:00", `2026-08-18T08:57:16+02:00\t${SUBJECT}\n`);

  test("a description newer than the last analyze is stale (criterion 1)", async () => {
    const git = stale();
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(true);
  });

  test("a description older than the last analyze is not (criterion 4)", async () => {
    const git = gitFor("2026-08-18T08:00:00+02:00", `2026-08-18T08:57:16+02:00\t${SUBJECT}\n`);
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(false);
  });

  test("one answer stands for the whole TTL (criterion 9)", async () => {
    const git = stale();
    let clock = 1000;
    const checker = new DescriptionFreshnessChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    expect(await checker.isStale(DIR, FOLDER)).toBe(true);
    const spawned = git.calls.length;
    expect(spawned).toBeGreaterThan(0);
    clock += 5000;
    expect(await checker.isStale(DIR, FOLDER)).toBe(true);
    expect(git.calls.length).toBe(spawned);
    // Past the TTL it asks again — an answer that never expires is a
    // badge a re-run cannot clear.
    clock += 30_000;
    expect(await checker.isStale(DIR, FOLDER)).toBe(true);
    expect(git.calls.length).toBeGreaterThan(spawned);
  });

  test("git failing or timing out degrades to not stale (criterion 10)", async () => {
    const thrower = new DescriptionFreshnessChecker({
      run: async () => {
        throw new Error("timed out");
      },
    });
    expect(await thrower.isStale(DIR, FOLDER)).toBe(false);
    const failing = new DescriptionFreshnessChecker({ run: gitFor(null, null).run });
    expect(await failing.isStale(DIR, FOLDER)).toBe(false);
  });

  // No description commit means nothing to compare, and the second
  // lookup would be a subprocess spawned for an answer that cannot
  // change the result.
  test("no description commit asks git nothing further", async () => {
    const git = gitFor(null, `2026-08-18T08:57:16+02:00\t${SUBJECT}\n`);
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(false);
    expect(git.calls).toHaveLength(1);
  });
});
