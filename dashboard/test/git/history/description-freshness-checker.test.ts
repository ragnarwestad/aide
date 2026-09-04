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
// This file covers DescriptionFreshnessChecker, the stateful, TTL-cached
// wrapper around the lookups tested in description-freshness-lookups.test.ts
// — including the reopen boundary and the synchronous peekStale read.

import { describe, expect, test } from "bun:test";
import {
  DescriptionFreshnessChecker,
} from "../../../src/git/description-freshness.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

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

// --- spec 198: the reopen boundary ------------------------------------------
//
// A reopened spec's earlier round is still in the repository, and its
// `analyze` commit is still the newest one `lastAnalyzeCommit` can find.
// Left alone, the staleness badge would go on comparing this round's
// description against an analysis run before the spec was reopened —
// the third reader of the same commit grammar, and the one the plan
// review found missing.
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
