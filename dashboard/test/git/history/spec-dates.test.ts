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

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import {
  firstCommitAt,
  firstCommitAtFollowingRenames,
  lastCommitAt,
  lastCommitOf,
} from "../../../src/git/description-freshness.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const DIR = "/specs/aide/96-merge-button-says-what-it-merges";

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

// --- spec 317: dating an archived spec across the archive step's `git mv` --
//
// `firstCommitAt` runs a directory pathspec (`.`), which only sees
// commits touching the CURRENT path — once a spec's folder has been
// `git mv`'d into `archive/`, that query answers with the archive date,
// not the spec's true beginning. `--follow` crosses exactly this kind
// of rename, but git only supports it for a single file, never a
// directory — hence a fixed, always-present file (`0-README.md`)
// instead of `.`.
describe("firstCommitAtFollowingRenames", () => {
  test("returns the OLDEST commit's date, not the newest", async () => {
    const git = fakeGit({
      "log --follow --format=%aI": {
        code: 0,
        stdout: "2026-08-22T10:00:00+02:00\n2026-08-17T09:00:00+02:00\n",
      },
    });
    expect(await firstCommitAtFollowingRenames(git.run, DIR, "0-README.md")).toBe(
      "2026-08-17T09:00:00+02:00",
    );
  });

  test("asks with --follow, on the one named file, guarded by --", async () => {
    const git = fakeGit({
      "log --follow --format=%aI": { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" },
    });
    await firstCommitAtFollowingRenames(git.run, DIR, "0-README.md");
    expect(git.calls[0]!.args).toEqual(["log", "--follow", "--format=%aI", "--", "0-README.md"]);
    expect(git.calls[0]!.dir).toBe(DIR);
  });

  test("a file git has never seen is null, not an invented date", async () => {
    const git = fakeGit({ "log --follow --format=%aI": { code: 0, stdout: "\n" } });
    expect(await firstCommitAtFollowingRenames(git.run, DIR, "0-README.md")).toBeNull();
  });

  test("git failing at all is null — a spec outside git still renders", async () => {
    expect(await firstCommitAtFollowingRenames(fakeGit({}).run, DIR, "0-README.md")).toBeNull();
  });

  // What a fake runner cannot prove: that `--follow` actually survives a
  // REAL `git mv` of the file's containing directory — the exact
  // transformation `aide-archive-spec` performs, and the reason
  // Approach A (a plain directory pathspec against the new path) reads
  // as the archive date instead of the spec's true beginning.
  test("survives a real `git mv` of the file's own directory", async () => {
    const gitIn = (dir: string, ...args: string[]) =>
      Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], stdout: "pipe", stderr: "pipe" });
    const repo = mkdtempSync(join(tmpdir(), "aide-spec-dates-"));
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "config", "user.name", "Test");
    gitIn(repo, "config", "user.email", "test@example.com");
    const specDir = join(repo, "91-old-name");
    mkdirSync(specDir);
    writeFileSync(join(specDir, "0-README.md"), "# spec\n");
    gitIn(repo, "add", "-A");
    gitIn(
      repo,
      "commit",
      "-q",
      "-m",
      "create",
      "--date=2026-07-01T09:00:00+02:00",
    );
    // A later commit under the pre-move name, so the oldest is not
    // simply the only one.
    writeFileSync(join(specDir, "2-analysis.md"), "# analysis\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "analyze", "--date=2026-07-05T09:00:00+02:00");
    mkdirSync(join(repo, "archive"));
    gitIn(repo, "mv", "91-old-name", "archive/91-old-name");
    gitIn(repo, "commit", "-q", "-m", "archive", "--date=2026-08-01T09:00:00+02:00");

    const archivedDir = join(repo, "archive", "91-old-name");
    // The trap Approach A falls into, proven alongside the fix: a plain
    // directory pathspec against the NEW path sees only the move.
    expect(await firstCommitAt(createGitRunner(), archivedDir, ".")).toBe(
      "2026-08-01T09:00:00+02:00",
    );
    expect(
      await firstCommitAtFollowingRenames(createGitRunner(), archivedDir, "0-README.md"),
    ).toBe("2026-07-01T09:00:00+02:00");
  });

  // Spec 324: `0-README.md` is the same fixed template in every spec, so
  // `--follow`'s content-similarity rename match can pair it with an
  // UNRELATED spec's deleted `0-README.md` in the same commit, and the
  // date returned is that stranger's, not this spec's own. This is a
  // simplified reproduction of git's content-based rename mechanism, not
  // a literal replay of `aide-archive-spec`'s own commit shape (which
  // `git mv`s only one spec's own folder per commit) — it exists to
  // prove the underlying git behavior and this fix's effect on it.
  test("0-README.md's shared template content misattributes across specs; 1-description.md's does not", async () => {
    const gitIn = (dir: string, ...args: string[]) =>
      Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], stdout: "pipe", stderr: "pipe" });
    const repo = mkdtempSync(join(tmpdir(), "aide-spec-dates-cross-"));
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "config", "user.name", "Test");
    gitIn(repo, "config", "user.email", "test@example.com");

    const TEMPLATE = "# spec\n\n## Table of contents\n\n- [Tracking info](#tracking-info)\n";

    // Commit 1 (oldest): spec 91 is created with the shared template
    // README and a distinctive, paragraph-length description.
    const firstDir = join(repo, "91-first");
    mkdirSync(firstDir);
    writeFileSync(join(firstDir, "0-README.md"), TEMPLATE);
    writeFileSync(
      join(firstDir, "1-description.md"),
      "The export button on the invoice page silently drops rows whose " +
        "currency differs from the account default, and the CSV that comes " +
        "out has fewer lines than the table on screen with no warning that " +
        "anything was left out.\n",
    );
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "create 91", "--date=2026-07-01T09:00:00+02:00");

    // Commit 2 (same commit): spec 91's files are removed (simulating an
    // earlier, unrelated rename elsewhere) and spec 92 is added with the
    // SAME template README but a different, equally distinctive
    // description — so git's rename detection pairs the two
    // byte-identical READMEs but not the two dissimilar descriptions.
    const secondDir = join(repo, "92-second");
    mkdirSync(secondDir);
    writeFileSync(join(secondDir, "0-README.md"), TEMPLATE);
    writeFileSync(
      join(secondDir, "1-description.md"),
      "The nightly backup job reports success even when the upload to " +
        "cold storage times out partway through, because the retry wrapper " +
        "swallows the timeout error instead of letting it fail the step, so " +
        "a missing backup is only found when someone needs to restore.\n",
    );
    gitIn(repo, "rm", "-q", "-r", "91-first");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "replace 91 with 92", "--date=2026-07-15T09:00:00+02:00");

    // Commit 3: the real archive step's own operation.
    mkdirSync(join(repo, "archive"));
    gitIn(repo, "mv", "92-second", "archive/92-second");
    gitIn(repo, "commit", "-q", "-m", "archive 92", "--date=2026-08-01T09:00:00+02:00");

    const archivedDir = join(repo, "archive", "92-second");
    // The bug: the shared template pairs with spec 91's deleted README
    // and the date returned is spec 91's, not spec 92's own.
    expect(
      await firstCommitAtFollowingRenames(createGitRunner(), archivedDir, "0-README.md"),
    ).toBe("2026-07-01T09:00:00+02:00");
    // The fix: the description is unique enough that no rename is found
    // across the unrelated deletion, and the date returned is spec 92's
    // own true creation commit.
    expect(
      await firstCommitAtFollowingRenames(createGitRunner(), archivedDir, "1-description.md"),
    ).toBe("2026-07-15T09:00:00+02:00");
  });
});
