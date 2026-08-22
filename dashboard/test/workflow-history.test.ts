// Spec 154: which steps a spec has HAD, asked of git rather than of a
// markdown line somebody's model wrote.
//
// Two incidents on 2026-08-21, in opposite directions. 147's implement
// finished RED and GREEN and was killed by the step's time limit before
// the model reached the part that writes `4-status.md`, so the row read
// "implement not run" about a spec whose code was on the branch. 153's
// files were copied from a sibling whose analyze had landed, so a
// brand-new spec claimed three steps it had never had.
//
// The subject grammar is the whole rule under test, so most of this
// file answers from a fake runner — what is asked of git, and what an
// unparseable answer degrades to. The one case a fake cannot prove is
// the SCOPE: that a commit sitting on a spec's own unlanded branch is
// found at all. That one drives real git.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkflowHistoryChecker,
  readWorkflowSubjects,
  workflowLogArgs,
} from "../src/workflow-history.ts";
import { createGitRunner } from "../src/branch-status.ts";
import { fakeGit } from "./helpers/fake-git.ts";

const FOLDER = "154-the-runner-owns-the-record-of-what-has-run";
const DIR = `/specs/aide/${FOLDER}`;

const subject = (step: string, opts: { headless?: boolean; stopped?: string; folder?: string } = {}) =>
  `Run /aide-${step} for ${opts.folder ?? FOLDER}` +
  (opts.headless === false ? "" : " (headless)") +
  (opts.stopped ? ` (stopped: ${opts.stopped})` : "");

/** git log prints NEWEST FIRST, and every case here depends on that. */
const gitLogging = (...subjects: string[]) =>
  fakeGit({ log: { code: 0, stdout: subjects.join("\n") + "\n" } });

describe("readWorkflowSubjects", () => {
  // AC1, the 153 incident: the file can claim whatever it likes.
  test("a spec with no matching commits has had no steps", () => {
    expect(readWorkflowSubjects([], FOLDER)).toEqual({ done: [], stopped: {} });
  });

  test("a commit for ANOTHER spec never counts, however close the name", () => {
    const history = readWorkflowSubjects(
      [subject("analyze", { folder: "15-something-else" }), subject("analyze", { folder: `${FOLDER}-two` })],
      FOLDER,
    );
    expect(history.done).toEqual([]);
  });

  test("landed steps come back in workflow order, not log order", () => {
    const history = readWorkflowSubjects(
      [subject("implement"), subject("analyze"), subject("create")],
      FOLDER,
    );
    expect(history.done).toEqual(["create", "analyze", "implement"]);
  });

  // Criterion 2 (spec 181), description requirement 2: "every archived
  // spec whose history contains a review-plan run still displays that
  // history". `review-plan` folded into `analyze` and is gone from
  // `HISTORY_STEPS` — a NEW run can neither be asked for it nor write
  // it as its own step — but a commit made before the fold is still on
  // disk, and `HISTORY_STEPS_RETIRED` is what keeps it recognized.
  test("a historical review-plan commit still counts as completed", () => {
    const history = readWorkflowSubjects(
      [subject("review-plan"), subject("analyze"), subject("create")],
      FOLDER,
    );
    // Current arc order first, then retired steps: `review-plan` is not
    // woven back into its old position, only kept from vanishing.
    expect(history.done).toEqual(["create", "analyze", "review-plan"]);
  });

  // AC2, the 147 incident: the reason reaches the caller, so a row can
  // say what happened instead of "not run".
  test("a stopped step is reported with its reason, and is not done", () => {
    const history = readWorkflowSubjects(
      [subject("implement", { stopped: "timeout" }), subject("analyze")],
      FOLDER,
    );
    expect(history.done).toEqual(["analyze"]);
    expect(history.stopped).toEqual({ implement: "timeout" });
  });

  // AC4: the newest commit for a step is the one that speaks for it.
  test("a completed re-run supersedes the stopped attempt before it", () => {
    const history = readWorkflowSubjects(
      [subject("implement"), subject("implement", { stopped: "timeout" })],
      FOLDER,
    );
    expect(history.done).toEqual(["implement"]);
    expect(history.stopped).toEqual({});
  });

  test("and a stop AFTER a completed run is what the step now reads as", () => {
    const history = readWorkflowSubjects(
      [subject("implement", { stopped: "budget_exhausted" }), subject("implement")],
      FOLDER,
    );
    expect(history.done).toEqual([]);
    expect(history.stopped).toEqual({ implement: "budget_exhausted" });
  });

  // AC5: a step run at somebody's keyboard, committed by hand with the
  // same subject, counts exactly as a headless one does.
  test("an interactive commit without the headless marker counts", () => {
    const history = readWorkflowSubjects([subject("analyze", { headless: false })], FOLDER);
    expect(history.done).toEqual(["analyze"]);
  });

  // The four the workflow arc is made of, plus the retired ones kept
  // for history (`HISTORY_STEPS_RETIRED`), and nothing else: explore
  // and manifest are steps the runner will execute but not stages a
  // spec passes through (`parse-status.ts`'s own list), and a word that
  // was never a step at all is ignored the same way.
  test("a step outside the tracked ones is ignored, not appended", () => {
    const history = readWorkflowSubjects(
      [subject("explore"), subject("manifest"), subject("resolve")],
      FOLDER,
    );
    expect(history).toEqual({ done: [], stopped: {} });
  });

  test("a subject that only looks like one is not a step", () => {
    const history = readWorkflowSubjects(
      [
        `Merge branch 'aide/${FOLDER}'`,
        `Revert "Run /aide-analyze for ${FOLDER} (headless)"`,
        `Run /aide-analyze for ${FOLDER} (headless) and then some`,
      ],
      FOLDER,
    );
    expect(history.done).toEqual([]);
  });
});

describe("workflowLogArgs", () => {
  test("searches every ref, not just HEAD — an implement commit has not landed", () => {
    const args = workflowLogArgs(FOLDER);
    expect(args).toContain("--all");
    // Narrowed server-side by a FIXED string, the way `lastAnalyzeCommit`
    // already narrows its own: cheap on a long history, and the subject
    // grammar decides the rest.
    expect(args).toContain("--fixed-strings");
    expect(args.some((a) => a === `--grep=Run /aide-` || a.includes(FOLDER))).toBe(true);
  });
});

describe("WorkflowHistoryChecker", () => {
  test("asks git once per spec and answers from the cache after that", async () => {
    const git = gitLogging(subject("analyze"));
    let clock = 0;
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => clock });
    expect((await checker.read(DIR, FOLDER)).done).toEqual(["analyze"]);
    expect((await checker.read(DIR, FOLDER)).done).toEqual(["analyze"]);
    expect(git.calls.length).toBe(1);
    clock = 60_000;
    await checker.read(DIR, FOLDER);
    expect(git.calls.length).toBe(2);
  });

  // The same direction every other unknown in this codebase takes: a
  // git that cannot answer leaves the spec reading as unfinished, which
  // is visible and fixed by running the step.
  test("a git that fails reports nothing rather than guessing", async () => {
    const git = fakeGit({ log: { code: 128, stdout: "" } });
    const checker = new WorkflowHistoryChecker({ run: git.run });
    expect(await checker.read(DIR, FOLDER)).toEqual({ done: [], stopped: {} });
  });

  test("a runner that throws is not an exception the page has to catch", async () => {
    const checker = new WorkflowHistoryChecker({
      run: async () => {
        throw new Error("no such directory");
      },
    });
    expect(await checker.read(DIR, FOLDER)).toEqual({ done: [], stopped: {} });
  });
});

// --- what only real git can prove -------------------------------------------

const gitIn = (dir: string, ...args: string[]) =>
  Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], stdout: "pipe", stderr: "pipe" });

describe("WorkflowHistoryChecker against real git", () => {
  test("finds a stopped implement commit that never left the spec's branch", async () => {
    const repo = mkdtempSync(join(tmpdir(), "aide-history-"));
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "config", "user.name", "Test");
    gitIn(repo, "config", "user.email", "test@example.com");
    const specDir = join(repo, FOLDER);
    mkdirSync(specDir);
    writeFileSync(join(specDir, "1-description.md"), "# spec\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-qm", subject("create"));
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", subject("analyze"));
    // The implement step's own commit, on the branch archive has not
    // landed yet — invisible to a HEAD-only search, which is the whole
    // reason the query names every ref.
    gitIn(repo, "checkout", "-q", "-b", `aide/${FOLDER}`);
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", subject("implement", { stopped: "timeout" }));
    gitIn(repo, "checkout", "-q", "main");

    const checker = new WorkflowHistoryChecker({ run: createGitRunner() });
    const history = await checker.read(specDir, FOLDER);
    expect(history.done).toEqual(["create", "analyze"]);
    expect(history.stopped).toEqual({ implement: "timeout" });
  });
});
