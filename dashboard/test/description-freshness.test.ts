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
  SpecCreatedAtChecker,
  SpecFileCommitChecker,
  firstCommitAt,
  isAnalyzeStale,
  descriptionDiffers,
  lastAnalyzeCommit,
  lastCommitAt,
  lastCommitOf,
} from "../src/description-freshness.ts";
import { fakeGit } from "./helpers/fake-git.ts";

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

describe("DescriptionFreshnessChecker", () => {
  const stale = () =>
    gitFor("2026-08-18T09:10:36+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");

  test("a description newer than the last analyze is stale (criterion 1)", async () => {
    const git = stale();
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(true);
  });

  // The whole point of comparing content: a description rewritten to
  // exactly what it was has a newer commit and says nothing new. Seen
  // on spec 132, where a section was added and taken out again and the
  // row went on asking for a re-analysis it did not need.
  test("a newer commit that changed nothing is not stale", async () => {
    const git = gitFor(
      "2026-08-18T09:10:36+02:00",
      analyzeLine("2026-08-18T08:57:16+02:00") + "\n",
      false,
    );
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(false);
    expect(git.calls.some((c) => c.args[0] === "diff")).toBe(true);
  });

  // The dates are the cheap gate: an older description cannot be stale
  // whatever it says, so the content is never asked for.
  test("an older description is settled without a diff", async () => {
    const git = gitFor("2026-08-18T08:00:00+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(false);
    expect(git.calls.some((c) => c.args[0] === "diff")).toBe(false);
  });

  test("a description older than the last analyze is not (criterion 4)", async () => {
    const git = gitFor("2026-08-18T08:00:00+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
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
    const git = gitFor(null, analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    expect(await checker.isStale(DIR, FOLDER)).toBe(false);
    expect(git.calls).toHaveLength(1);
  });
});

// --- spec 150: the same question, of all four files --------------------------
//
// The spec page stamps each of the four files with the commit that last
// touched it, so a reader can tell which version is on the screen. That
// is this module's own one-path question asked four times — with the
// SHA as well as the time, because "which version" is what the stamp is
// for.

describe("lastCommitOf", () => {
  const SPEC_FILES = ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"];

  test("answers with the commit and its time, per file", async () => {
    const git = fakeGit({
      "log -1 --format=%H": { code: 0, stdout: "a3f9c21deadbeef\t2026-08-21T09:14:00+02:00\n" },
    });
    expect(await lastCommitOf(git.run, DIR, "2-analysis.md")).toEqual({
      sha: "a3f9c21deadbeef",
      at: "2026-08-21T09:14:00+02:00",
    });
  });

  test("each file is asked about on its own — a folder-wide log answers for the wrong one", async () => {
    const git = fakeGit({
      "log -1 --format=%H": { code: 0, stdout: "a3f9c21\t2026-08-21T09:14:00+02:00\n" },
    });
    for (const name of SPEC_FILES) await lastCommitOf(git.run, DIR, name);
    expect(git.calls.map((c) => c.args[c.args.length - 1])).toEqual(SPEC_FILES);
    // `--` before the path, so a file named like a revision is a file.
    for (const call of git.calls) expect(call.args).toContain("--");
  });

  test("a file git has never seen is null, not an invented stamp", async () => {
    const git = fakeGit({ "log -1 --format=%H": { code: 0, stdout: "\n" } });
    expect(await lastCommitOf(git.run, DIR, "2-analysis.md")).toBeNull();
  });

  test("git failing at all is null — a spec outside git still renders", async () => {
    const git = fakeGit({});
    expect(await lastCommitOf(git.run, DIR, "1-description.md")).toBeNull();
  });

  test("lastCommitAt is the same answer with the sha dropped", async () => {
    const git = fakeGit({
      "log -1 --format=%H": { code: 0, stdout: "a3f9c21\t2026-08-21T09:14:00+02:00\n" },
    });
    expect(await lastCommitAt(git.run, DIR, "1-description.md")).toBe("2026-08-21T09:14:00+02:00");
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

describe("DescriptionFreshnessChecker with a reopen boundary", () => {
  const BOUNDARY = "1d0fe79cafe";

  test("passes the boundary on to the analyze lookup", async () => {
    const git = gitFor("2026-08-18T09:10:36+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
    const checker = new DescriptionFreshnessChecker({ run: git.run });
    await checker.isStale(DIR, FOLDER, BOUNDARY);
    expect(git.calls.some((c) => c.args.includes("--not") && c.args.includes(BOUNDARY))).toBe(true);
  });

  // Same reason the history checker's key folds it in: a spec reopened
  // while the dashboard is running would otherwise answer from the
  // pre-reopen entry for the whole TTL.
  test("a spec asked with and without a boundary is two questions", async () => {
    const git = gitFor("2026-08-18T09:10:36+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");
    const checker = new DescriptionFreshnessChecker({ run: git.run, now: () => 0 });
    await checker.isStale(DIR, FOLDER);
    const first = git.calls.length;
    await checker.isStale(DIR, FOLDER, BOUNDARY);
    expect(git.calls.length).toBeGreaterThan(first);
  });
});

// --- spec 199: when was this spec MADE? -------------------------------------
//
// The Started column used to hold the most recent run's own start, so a
// spec jumped to the top of the list every time a phase was started.
// The date it should hold instead cannot come from the queue — the job
// store is an LRU of 200, so a spec older than that has no record of
// its own beginning left. Git has one, and keeps it for years: the
// FIRST commit that touched the folder.
describe("firstCommitAt", () => {
  // `git log` prints newest first and `-1 --reverse` still answers with
  // the NEWEST commit — the limit is applied before the reversal. The
  // oldest is the last line of the unlimited log, and this is the test
  // that says so.
  test("returns the OLDEST commit's date, not the newest", async () => {
    const git = fakeGit({
      "log --format=%aI": {
        code: 0,
        stdout: "2026-08-22T10:00:00+02:00\n2026-08-19T14:30:00+02:00\n2026-08-17T09:00:00+02:00\n",
      },
    });
    expect(await firstCommitAt(git.run, DIR, ".")).toBe("2026-08-17T09:00:00+02:00");
  });

  test("the whole folder is the pathspec, and `--` guards it", async () => {
    const git = fakeGit({ "log --format=%aI": { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" } });
    await firstCommitAt(git.run, DIR, ".");
    expect(git.calls[0]!.args).toEqual(["log", "--format=%aI", "--", "."]);
    expect(git.calls[0]!.dir).toBe(DIR);
  });

  test("one commit is both the first and the last", async () => {
    const git = fakeGit({ "log --format=%aI": { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" } });
    expect(await firstCommitAt(git.run, DIR, ".")).toBe("2026-08-17T09:00:00+02:00");
  });

  test("a folder git has never seen is null, not an invented date", async () => {
    const git = fakeGit({ "log --format=%aI": { code: 0, stdout: "\n" } });
    expect(await firstCommitAt(git.run, DIR, ".")).toBeNull();
  });

  test("git failing at all is null — a spec outside git still renders", async () => {
    expect(await firstCommitAt(fakeGit({}).run, DIR, ".")).toBeNull();
  });
});

describe("SpecCreatedAtChecker", () => {
  const dated = () =>
    fakeGit({
      "log --format=%aI": {
        code: 0,
        stdout: "2026-08-22T10:00:00+02:00\n2026-08-17T09:00:00+02:00\n",
      },
    });

  test("answers with the folder's first commit", async () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run });
    expect(await checker.createdAt(DIR, FOLDER)).toBe("2026-08-17T09:00:00+02:00");
  });

  // One answer stands for its TTL. Without it the list would spawn a
  // git process per spec on every redraw, exactly as the other two
  // checkers beside it already refuse to.
  test("a second ask inside the TTL runs no git at all", async () => {
    const git = dated();
    let clock = 1000;
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.createdAt(DIR, FOLDER);
    clock += 29_000;
    await checker.createdAt(DIR, FOLDER);
    expect(git.calls).toHaveLength(1);
  });

  test("past the TTL it asks again", async () => {
    const git = dated();
    let clock = 1000;
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.createdAt(DIR, FOLDER);
    clock += 31_000;
    await checker.createdAt(DIR, FOLDER);
    expect(git.calls).toHaveLength(2);
  });

  // Two specs are two questions. A cache keyed on one of them would
  // give every spec on the page the first one's date.
  test("each spec is cached on its own", async () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run });
    await checker.createdAt(DIR, FOLDER);
    await checker.createdAt("/specs/aide/97-other", "97-other");
    expect(git.calls).toHaveLength(2);
  });

  // Fails to `null`, never to a `Job` date: a job-backed fallback would
  // put back the very thing this change removes, since a job's own
  // start moves every time a phase runs.
  test("git failing leaves the answer null", async () => {
    const checker = new SpecCreatedAtChecker({ run: fakeGit({}).run });
    expect(await checker.createdAt(DIR, FOLDER)).toBeNull();
  });

  test("a runner that throws is null too, not an exception on the page", async () => {
    const checker = new SpecCreatedAtChecker({
      run: async () => {
        throw new Error("no such directory");
      },
    });
    expect(await checker.createdAt(DIR, FOLDER)).toBeNull();
  });
});

// Spec 208: every question a page render asks gets a read that spawns
// nothing. The async methods above are unchanged — a background warmer
// is what keeps calling them — and these are what the render calls
// instead.
describe("DescriptionFreshnessChecker.peekStale", () => {
  const stale = () =>
    gitFor("2026-08-18T09:10:36+02:00", analyzeLine("2026-08-18T08:57:16+02:00") + "\n");

  test("a spec nothing has ever asked about answers null, and spawns no git", () => {
    const git = stale();
    const checker = new DescriptionFreshnessChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(checker.peekStale(DIR, FOLDER)).toEqual({ stale: false, checkedAt: null });
    expect(git.calls.length).toBe(0);
  });

  test("after a check, it hands back that answer and when it was taken", async () => {
    const git = stale();
    const checker = new DescriptionFreshnessChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.isStale(DIR, FOLDER);
    const before = git.calls.length;
    expect(checker.peekStale(DIR, FOLDER)).toEqual({ stale: true, checkedAt: 1000 });
    expect(git.calls.length).toBe(before);
  });

  test("past the TTL the same answer stands, with its original timestamp", async () => {
    const git = stale();
    let clock = 1000;
    const checker = new DescriptionFreshnessChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.isStale(DIR, FOLDER);
    clock += 60_000;
    expect(checker.peekStale(DIR, FOLDER)).toEqual({ stale: true, checkedAt: 1000 });
  });

  // The boundary is part of the QUESTION (spec 198), so it is part of
  // the peek's key too — a reopened spec must not read the pre-reopen
  // entry.
  test("a different reopen boundary is a different question", async () => {
    const git = stale();
    const checker = new DescriptionFreshnessChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.isStale(DIR, FOLDER);
    expect(checker.peekStale(DIR, FOLDER, "abc1234")).toEqual({ stale: false, checkedAt: null });
  });
});

describe("SpecCreatedAtChecker.peekCreatedAt", () => {
  const dated = () =>
    fakeGit({
      "log --format=%aI": {
        code: 0,
        stdout: "2026-08-22T10:00:00+02:00\n2026-08-17T09:00:00+02:00\n",
      },
    });

  test("a spec nothing has ever asked about answers null, and spawns no git", () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(checker.peekCreatedAt(DIR, FOLDER)).toEqual({ createdAt: null, checkedAt: null });
    expect(git.calls.length).toBe(0);
  });

  test("after a check, it hands back that date and when it was taken", async () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.createdAt(DIR, FOLDER);
    const before = git.calls.length;
    expect(checker.peekCreatedAt(DIR, FOLDER)).toEqual({
      createdAt: "2026-08-17T09:00:00+02:00",
      checkedAt: 1000,
    });
    expect(git.calls.length).toBe(before);
  });

  test("past the TTL the same date stands, with its original timestamp", async () => {
    const git = dated();
    let clock = 1000;
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.createdAt(DIR, FOLDER);
    clock += 60_000;
    expect(checker.peekCreatedAt(DIR, FOLDER).checkedAt).toBe(1000);
  });

  // Asked and undatable is a real answer, and a different cell from one
  // nobody has asked yet: the first shows a dash, the second "checking…".
  test("an undatable spec is a real, timestamped null", async () => {
    const git = fakeGit({});
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => 5000 });
    await checker.createdAt(DIR, FOLDER);
    expect(checker.peekCreatedAt(DIR, FOLDER)).toEqual({ createdAt: null, checkedAt: 5000 });
  });
});

// Spec 208: the one question in this codebase that was added without
// the cache every sibling has. The spec page ran `git log` for all four
// of its files on every single view.
describe("SpecFileCommitChecker", () => {
  const dated = () =>
    fakeGit({ "log -1 --format=%H": { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" } });

  test("answers with the commit that last touched the file", async () => {
    const git = dated();
    const checker = new SpecFileCommitChecker({ run: git.run });
    expect(await checker.commitFor(DIR, "1-description.md")).toEqual({
      sha: "deadbee",
      at: "2026-08-18T09:10:36+02:00",
    });
    expect(git.calls[0]!.args).toEqual([
      "log", "-1", "--format=%H%x09%aI", "--", "1-description.md",
    ]);
    expect(git.calls[0]!.dir).toBe(DIR);
  });

  test("a second ask inside the TTL runs no git at all", async () => {
    const git = dated();
    let clock = 1000;
    const checker = new SpecFileCommitChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.commitFor(DIR, "1-description.md");
    clock += 29_000;
    await checker.commitFor(DIR, "1-description.md");
    expect(git.calls).toHaveLength(1);
  });

  test("each file is its own question", async () => {
    const git = dated();
    const checker = new SpecFileCommitChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.commitFor(DIR, "1-description.md");
    await checker.commitFor(DIR, "4-status.md");
    expect(git.calls).toHaveLength(2);
  });

  test("a file nothing has ever asked about peeks null, and spawns no git", () => {
    const git = dated();
    const checker = new SpecFileCommitChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(checker.peekCommitFor(DIR, "1-description.md")).toEqual({
      sha: null,
      at: null,
      checkedAt: null,
    });
    expect(git.calls.length).toBe(0);
  });

  test("after a check, the peek hands back that stamp and when it was taken", async () => {
    const git = dated();
    const checker = new SpecFileCommitChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.commitFor(DIR, "1-description.md");
    const before = git.calls.length;
    expect(checker.peekCommitFor(DIR, "1-description.md")).toEqual({
      sha: "deadbee",
      at: "2026-08-18T09:10:36+02:00",
      checkedAt: 1000,
    });
    expect(git.calls.length).toBe(before);
  });

  test("past the TTL the same stamp stands, with its original timestamp", async () => {
    const git = dated();
    let clock = 1000;
    const checker = new SpecFileCommitChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.commitFor(DIR, "1-description.md");
    clock += 60_000;
    expect(checker.peekCommitFor(DIR, "1-description.md").checkedAt).toBe(1000);
  });

  // A file git cannot date still renders — a spec outside git, a file
  // never committed. Asked-and-undatable is timestamped, so the page
  // stops saying "checking…" about it.
  test("an undatable file is a real, timestamped null", async () => {
    const git = fakeGit({});
    const checker = new SpecFileCommitChecker({ run: git.run, ttlMs: 30_000, now: () => 5000 });
    await checker.commitFor(DIR, "1-description.md");
    expect(checker.peekCommitFor(DIR, "1-description.md")).toEqual({
      sha: null,
      at: null,
      checkedAt: 5000,
    });
  });
});
