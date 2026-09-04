// The checkers built on the commit lookups: when a spec was created,
// what an archived one answers, and when a spec's own file last moved.
//
// Split out of spec-dates.test.ts 2026-09-04; the tests are unchanged
// and keep their names.

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
// This file covers the per-file commit stamp (lastCommitOf,
// SpecFileCommitChecker) and the spec's own creation date
// (firstCommitAt, SpecCreatedAtChecker) — the staleness question itself
// lives in description-freshness-checker.test.ts.

import { describe, expect, test } from "bun:test";
import {
  SpecCreatedAtChecker,
  SpecFileCommitChecker,
} from "../../src/git/description-freshness.ts";
import { fakeGit } from "../helpers/fake-git.ts";

const DIR = "/specs/aide/96-merge-button-says-what-it-merges";
const FOLDER = "96-merge-button-says-what-it-merges";

// --- spec 150: the same question, of all four files --------------------------
//
// The spec page stamps each of the four files with the commit that last
// touched it, so a reader can tell which version is on the screen. That
// is this module's own one-path question asked four times — with the
// SHA as well as the time, because "which version" is what the stamp is
// for.

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

// --- spec 317: the archived-row counterpart, rename-aware and long-cached --
describe("SpecCreatedAtChecker.createdAtForArchived", () => {
  const ARCHIVE_DIR = "/specs/aide/archive/96-merge-button-says-what-it-merges";
  const dated = () =>
    fakeGit({
      "log --follow --format=%aI": {
        code: 0,
        stdout: "2026-08-22T10:00:00+02:00\n2026-08-17T09:00:00+02:00\n",
      },
    });

  test("answers with the rename-aware lookup's oldest date", async () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run });
    expect(await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER)).toBe(
      "2026-08-17T09:00:00+02:00",
    );
    expect(git.calls[0]!.args).toEqual([
      "log", "--follow", "--format=%aI", "--", "1-description.md",
    ]);
  });

  test("git failing leaves the answer null", async () => {
    const checker = new SpecCreatedAtChecker({ run: fakeGit({}).run });
    expect(await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER)).toBeNull();
  });

  // A resolved answer is cached far longer than the standard TTL — an
  // archived spec's own history cannot change after the fact, so a
  // second ask well past the ordinary 30s window still spawns nothing.
  test("a resolved answer stands long past the standard TTL", async () => {
    const git = dated();
    let clock = 1000;
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER);
    clock += 60_000;
    await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER);
    expect(git.calls).toHaveLength(1);
  });

  // A genuine "cannot date" answer keeps the ordinary, short TTL — a
  // spec missing 0-README.md today might have it restored, and the
  // long cache above must not lock that in as permanent.
  test("an undatable answer is retried on the ordinary schedule, not the long one", async () => {
    const git = fakeGit({});
    let clock = 1000;
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => clock });
    await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER);
    clock += 31_000;
    await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER);
    expect(git.calls).toHaveLength(2);
  });
});

describe("SpecCreatedAtChecker.peekCreatedAtForArchived", () => {
  const ARCHIVE_DIR = "/specs/aide/archive/96-merge-button-says-what-it-merges";
  const dated = () =>
    fakeGit({
      "log --follow --format=%aI": { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" },
    });

  test("nothing asked yet answers null, and spawns no git", () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    expect(checker.peekCreatedAtForArchived(ARCHIVE_DIR, FOLDER)).toEqual({
      createdAt: null,
      checkedAt: null,
    });
    expect(git.calls.length).toBe(0);
  });

  test("after a check, it hands back that date and when it was taken", async () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER);
    expect(checker.peekCreatedAtForArchived(ARCHIVE_DIR, FOLDER)).toEqual({
      createdAt: "2026-08-17T09:00:00+02:00",
      checkedAt: 1000,
    });
  });

  // The live spec's own peek must never answer for the archived
  // question or the reverse — a spec that is both dated live (before
  // archiving) and re-asked afterwards must not have one overwrite the
  // other's cache entry.
  test("is a different cache entry from the live peekCreatedAt", async () => {
    const git = dated();
    const checker = new SpecCreatedAtChecker({ run: git.run, ttlMs: 30_000, now: () => 1000 });
    await checker.createdAtForArchived(ARCHIVE_DIR, FOLDER);
    expect(checker.peekCreatedAt(ARCHIVE_DIR, FOLDER)).toEqual({ createdAt: null, checkedAt: null });
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
