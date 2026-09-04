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
import {
  WorkflowHistoryChecker,
  readWorkflowSubjects,
  stepsFileDisagreesOn,
  workflowLogArgs,
} from "../../src/git/workflow-history.ts";
import { fakeGit } from "../helpers/fake-git.ts";

const FOLDER = "154-the-runner-owns-the-record-of-what-has-run";
const DIR = `/specs/aide/${FOLDER}`;

const subject = (
  step: string,
  opts: { headless?: boolean; stopped?: string; folder?: string; model?: string } = {},
) =>
  `Run /aide-${step} for ${opts.folder ?? FOLDER}` +
  (opts.headless === false ? "" : " (headless)") +
  // Spec 217's suffix sits BEFORE the stop reason, which is read
  // greedily to the end of the subject — a suffix after it would be
  // swallowed into the reason.
  (opts.model ? ` (model: ${opts.model})` : "") +
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

  // Spec 217, AC7: the grammar gained a `(model: ...)` suffix, and this
  // side of the pair has to keep deriving the same answer from a
  // subject that carries one. Both regexes anchor on `$`, so a suffix
  // the pattern does not know about does not degrade — it stops
  // matching altogether, and the step disappears from the history.
  test("a subject carrying a model suffix reads exactly as one without", () => {
    const withModel = readWorkflowSubjects(
      [subject("implement", { model: "claude claude-sonnet-5" }), subject("analyze", { model: "codex gpt-5" })],
      FOLDER,
    );
    expect(withModel).toEqual(readWorkflowSubjects([subject("implement"), subject("analyze")], FOLDER));
    expect(withModel.done).toEqual(["analyze", "implement"]);
  });

  test("a model suffix does not leak into the stop reason", () => {
    const history = readWorkflowSubjects(
      [subject("implement", { model: "claude claude-sonnet-5", stopped: "timeout" })],
      FOLDER,
    );
    expect(history.done).toEqual([]);
    expect(history.stopped).toEqual({ implement: "timeout" });
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

describe("stepsFileDisagreesOn", () => {
  // REQ-2: no state file for this copy of the spec — today's unchanged
  // two-directional prose-vs-git comparison.
  test("flags a step the file claims that git has no commit for (spec 153)", () => {
    expect(
      stepsFileDisagreesOn(
        { proseSteps: ["create", "analyze", "implement"], stateSteps: undefined },
        { done: ["create", "analyze"], stopped: {} },
      ),
    ).toEqual(["implement"]);
  });

  // Spec 298: `fileSteps` now follows the open branch when one exists,
  // which is where `implement` actually writes this line — so a
  // disagreement in THIS direction is once more a real one (spec 147's
  // killed run), not the structural lag spec 299 briefly special-cased
  // this function for before spec 298 fixed it at the read side.
  test("flags implement when git has it but the file (read fresh) still doesn't", () => {
    expect(
      stepsFileDisagreesOn(
        { proseSteps: ["create", "analyze"], stateSteps: undefined },
        { done: ["create", "analyze", "implement"], stopped: {} },
      ),
    ).toEqual(["implement"]);
  });

  test("flags analyze when git has it but the file has not caught up (spec 147)", () => {
    expect(
      stepsFileDisagreesOn(
        { proseSteps: ["create"], stateSteps: undefined },
        { done: ["create", "analyze"], stopped: {} },
      ),
    ).toEqual(["analyze"]);
  });

  test("still ignores create, in either direction", () => {
    expect(stepsFileDisagreesOn({ proseSteps: ["create"], stateSteps: undefined }, { done: [], stopped: {} })).toEqual(
      [],
    );
    expect(
      stepsFileDisagreesOn({ proseSteps: [], stateSteps: undefined }, { done: ["create"], stopped: {} }),
    ).toEqual([]);
  });

  // REQ-1/REQ-5: once a state file exists, it is the truth — git is
  // never consulted again, however git's own history disagrees with it.
  // Spec 349's own incident: an amended, unpushed `analyze` commit.
  test("a state file's own phase is never compared against git, once one exists", () => {
    expect(
      stepsFileDisagreesOn(
        { proseSteps: ["create", "analyze"], stateSteps: ["create", "analyze"] },
        { done: ["create"], stopped: {} },
      ),
    ).toEqual([]);
  });

  // REQ-3: the one case still caught with a state file present — the
  // prose claims a phase the state file does not have. Git DOES have
  // the commit here, so a prose-vs-git comparison would find no
  // disagreement — only a prose-vs-state-file comparison catches this.
  test("flags a phase the prose claims that the state file lacks, even though git has it", () => {
    expect(
      stepsFileDisagreesOn(
        { proseSteps: ["create", "analyze", "implement"], stateSteps: ["create", "analyze"] },
        { done: ["create", "analyze", "implement"], stopped: {} },
      ),
    ).toEqual(["implement"]);
  });

  // The reverse direction is not reported once a state file exists
  // (Risk analysis item 5: the writer scripts update both files
  // together, so the state file is never ahead of its own prose).
  test("does not flag a phase the state file has that the prose does not, once a state file exists", () => {
    expect(
      stepsFileDisagreesOn(
        { proseSteps: ["create"], stateSteps: ["create", "analyze"] },
        { done: ["create"], stopped: {} },
      ),
    ).toEqual([]);
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

// Spec 208: the read a page render makes. `history: null` is the whole
// point of the shape — a spec the warmer has not reached yet is not a
// spec with no steps, and a row that said "nothing has run" about it
// would be exactly the false negative this spec exists to stop.
describe("WorkflowHistoryChecker.peekHistory", () => {
  test("a spec nothing has ever asked about answers null, and spawns no git", () => {
    const git = gitLogging(subject("analyze"));
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => 1000 });
    expect(checker.peekHistory(DIR, FOLDER)).toEqual({ history: null, checkedAt: null });
    expect(git.calls.length).toBe(0);
  });

  test("after a read, it hands back that history and when it was taken", async () => {
    const git = gitLogging(subject("analyze"));
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => 1000 });
    await checker.read(DIR, FOLDER);
    const before = git.calls.length;
    const { history, checkedAt } = checker.peekHistory(DIR, FOLDER);
    expect(history).toEqual({ done: ["analyze"], stopped: {} });
    expect(checkedAt).toBe(1000);
    expect(git.calls.length).toBe(before);
  });

  // The distinction the render depends on: a real, empty history is an
  // answer ("nothing has run yet"); a null one is the absence of one.
  test("a real empty history is not the same as never having asked", async () => {
    const git = fakeGit({ log: { code: 128, stdout: "" } });
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => 5000 });
    await checker.read(DIR, FOLDER);
    expect(checker.peekHistory(DIR, FOLDER)).toEqual({
      history: { done: [], stopped: {} },
      checkedAt: 5000,
    });
  });

  test("past the TTL the same history stands, with its original timestamp", async () => {
    const git = gitLogging(subject("analyze"));
    let clock = 1000;
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => clock });
    await checker.read(DIR, FOLDER);
    clock += 60_000;
    expect(checker.peekHistory(DIR, FOLDER).checkedAt).toBe(1000);
  });

  // The boundary is part of the question (spec 198), so it is part of
  // the peek's key too.
  test("a different reopen boundary is a different question", async () => {
    const git = gitLogging(subject("analyze"));
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => 1000 });
    await checker.read(DIR, FOLDER);
    expect(checker.peekHistory(DIR, FOLDER, "abc1234").history).toBeNull();
  });
});
