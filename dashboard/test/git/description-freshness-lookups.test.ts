// Spec 97: a spec's 1-description.md can move on after `analyze` has
// run, and the row went on reading `analyze ✓` — the only person who
// knew a re-run was due was the one who made the edit.
//
// The question is asked of git, in the specs repo, because that is the
// one record that survives a worktree, a dashboard restart and a
// different machine. Everything here is answered by a fake runner: the
// rule under test is which commits are consulted and what an
// unprovable answer degrades to, never whether git works.
//
// This file covers the pure lookup functions: isAnalyzeStale,
// lastCommitAt, lastAnalyzeCommit (including the reopen boundary) and
// descriptionDiffers. The stateful checkers built on top of them live in
// description-freshness-checker.test.ts and spec-dates.test.ts.

import { describe, expect, test } from "bun:test";
import {
  descriptionDiffers,
  isAnalyzeStale,
  lastAnalyzeCommit,
  lastCommitAt,
} from "../../src/git/description-freshness.ts";
import { fakeGit } from "../helpers/fake-git.ts";

const DIR = "/specs/aide/96-merge-button-says-what-it-merges";
const FOLDER = "96-merge-button-says-what-it-merges";
const SUBJECT = `Run /aide-analyze for ${FOLDER} (headless)`;

/** What the two lookups are keyed on: the description's own history,
 *  and the analyze commits. Kept apart so a test can move one without
 *  the other. */
const gitFor = (description: string | null, analyzeLog: string | null, differs = true) =>
  fakeGit({
    "log -1 --format=%H": description === null ? { code: 1 } : { code: 0, stdout: `deadbee\t${description}\n` },
    "log --format=%H%x09%aI%x09%s":
      analyzeLog === null ? { code: 1 } : { code: 0, stdout: analyzeLog },
    // `git diff --quiet`: 0 identical, 1 different.
    "diff --quiet": { code: differs ? 1 : 0 },
  });

/** An analyze log line in the shape the lookup now reads. The sha is
 *  arbitrary; only the diff stub above cares that there is one. */
const analyzeLine = (at: string, subject = SUBJECT) => `deadbee\t${at}\t${subject}`;

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
    expect(git.calls[0]!.args).toEqual(["log", "-1", "--format=%H%x09%aI", "--", "1-description.md"]);
    expect(git.calls[0]!.dir).toBe(DIR);
  });

  test("null when git fails or prints nothing", async () => {
    expect(await lastCommitAt(gitFor(null, null).run, DIR, "1-description.md")).toBeNull();
    const empty = fakeGit({ "log -1": { code: 0, stdout: "\n" } });
    expect(await lastCommitAt(empty.run, DIR, "1-description.md")).toBeNull();
  });
});

describe("lastAnalyzeCommit", () => {
  test("matches the exact success message a headless run leaves", async () => {
    const git = gitFor(null, analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
    expect((await lastAnalyzeCommit(git.run, DIR, FOLDER))?.at).toBe("2026-08-18T08:57:16+02:00");
    expect(git.calls[0]!.args).toEqual([
      "log", "--format=%H%x09%aI%x09%s", "--fixed-strings", `--grep=${SUBJECT}`,
    ]);
  });

  // The sharp edge: the success message is a PREFIX of the stopped
  // one, and a fixed-string grep matches prefixes. Only the equality
  // check in JS tells the two apart.
  test("a stopped run with the same prefix is not a successful analyze (criterion 7)", async () => {
    const git = gitFor(
      null,
      [
        analyzeLine("2026-08-18T09:00:00+02:00", `${SUBJECT} (stopped: budget)`),
        analyzeLine("2026-08-18T08:00:00+02:00"),
      ].join("\n"),
    );
    expect((await lastAnalyzeCommit(git.run, DIR, FOLDER))?.at).toBe("2026-08-18T08:00:00+02:00");
  });

  test("the newest of several re-runs wins (criterion 5)", async () => {
    const git = gitFor(
      null,
      [
        analyzeLine("2026-08-18T11:00:00+02:00"),
        analyzeLine("2026-08-18T08:57:16+02:00"),
      ].join("\n"),
    );
    expect((await lastAnalyzeCommit(git.run, DIR, FOLDER))?.at).toBe("2026-08-18T11:00:00+02:00");
  });

  test("a plan-merge commit is not mistaken for an analyze (criterion 6)", async () => {
    const git = gitFor(
      null,
      [
        analyzeLine("2026-08-18T10:00:00+02:00", `Merge remote-tracking branch 'refs/remotes/origin/aide/${FOLDER}'`),
        analyzeLine("2026-08-18T08:57:16+02:00"),
      ].join("\n"),
    );
    expect((await lastAnalyzeCommit(git.run, DIR, FOLDER))?.at).toBe("2026-08-18T08:57:16+02:00");
  });

  test("null when no analyze has ever been committed (criterion 8)", async () => {
    expect(await lastAnalyzeCommit(gitFor(null, "").run, DIR, FOLDER)).toBeNull();
    expect(await lastAnalyzeCommit(gitFor(null, null).run, DIR, FOLDER)).toBeNull();
  });

  test("another spec's analyze commit does not count as this one's", async () => {
    const git = gitFor(null, analyzeLine("2026-08-18T08:57:16+02:00", "Run /aide-analyze for 95-other (headless)") + "\n");
    expect(await lastAnalyzeCommit(git.run, DIR, FOLDER)).toBeNull();
  });
});

describe("descriptionDiffers", () => {
  test("exit 1 means the file says something else, 0 means it does not", async () => {
    expect(await descriptionDiffers(fakeGit({ diff: { code: 1 } }).run, DIR, "deadbee")).toBe(true);
    expect(await descriptionDiffers(fakeGit({ diff: { code: 0 } }).run, DIR, "deadbee")).toBe(false);
  });

  // Every unknown in this module points the same way: it cannot prove
  // staleness, so it does not claim any.
  test("any other exit code cannot prove a difference", async () => {
    expect(await descriptionDiffers(fakeGit({ diff: { code: 128 } }).run, DIR, "deadbee")).toBe(false);
  });

  test("it compares the working tree against the analyzed commit", async () => {
    const git = fakeGit({ diff: { code: 1 } });
    await descriptionDiffers(git.run, DIR, "deadbee");
    expect(git.calls[0]!.args).toEqual(["diff", "--quiet", "deadbee", "--", "1-description.md"]);
  });
});

// --- spec 198: the reopen boundary ------------------------------------------
//
// A reopened spec's earlier round is still in the repository, and its
// `analyze` commit is still the newest one `lastAnalyzeCommit` can find.
// Left alone, the staleness badge would go on comparing this round's
// description against an analysis run before the spec was reopened —
// the third reader of the same commit grammar, and the one the plan
// review found missing.
describe("lastAnalyzeCommit with a reopen boundary", () => {
  const BOUNDARY = "1d0fe79cafe";

  test("no boundary: asks exactly what it asked before the boundary existed", async () => {
    const git = gitFor("2026-08-18T09:10:36+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
    await lastAnalyzeCommit(git.run, DIR, FOLDER);
    expect(git.calls[git.calls.length - 1]!.args).not.toContain("--not");
  });

  test("with a boundary: excludes the earlier round, and still names a positive rev", async () => {
    const git = gitFor("2026-08-18T09:10:36+02:00", "");
    await lastAnalyzeCommit(git.run, DIR, FOLDER, BOUNDARY);
    const args = git.calls[git.calls.length - 1]!.args;
    expect(args).toContain("--not");
    expect(args).toContain(BOUNDARY);
    // `git log --not <sha>` with no positive rev walks nothing at all:
    // a revision argument stops git from defaulting to HEAD. Measured.
    expect(args).toContain("HEAD");
    expect(args.indexOf("HEAD")).toBeLessThan(args.indexOf("--not"));
  });
});
