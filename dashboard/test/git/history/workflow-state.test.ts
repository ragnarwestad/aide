// What a spec's steps resolve to when the file and the git history are
// read together, and what a reopen boundary does to both.
//
// Split out of workflow-history.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

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
  BranchFileStepsChecker,
  WorkflowHistoryChecker,
  resolveWorkflowState,
  workflowLogArgs,
} from "../../../src/git/workflow-history.ts";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

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

// Spec 302: the one canonical `{ done, stopped, fileDisagrees, fileSteps }`
// a spec's steps resolve to, built from the same two peeks `withFreshness`
// used to assemble by hand — the `create` special case included.
describe("resolveWorkflowState", () => {
  const BRANCH_TARGET: OpenBranchTarget = {
    root: "/root",
    branch: `aide/${FOLDER}`,
    relPath: `aide/specs/${FOLDER}/4-status.md`,
    archivedRelPath: `aide/specs/archive/${FOLDER}/4-status.md`,
  };

  /** What `readStatusFromBranch` needs answered, for a branch whose
   *  `4-status.md` names `proseSteps` — the same shape branch-file-steps.test.ts
   *  already uses. When `stateSteps` is given, the branch's own sibling
   *  `4-status.json` answers too (spec 362) — keyed on the FULL show
   *  path, since a generic prefix cannot tell the `.md` request from the
   *  `.json` one. */
  const branchFileFake = (proseSteps: string[], stateSteps?: string[]) => {
    const jsonPath = BRANCH_TARGET.relPath.replace(/4-status\.md$/, "4-status.json");
    const answers: Record<string, { code: number; stdout?: string }> = {
      "fetch --quiet origin": { code: 0 },
      [`log -1 --format=%H refs/remotes/origin/${BRANCH_TARGET.branch} -- ${BRANCH_TARGET.relPath}`]: {
        code: 0,
        stdout: "deadbeef1234\n",
      },
      [`show refs/remotes/origin/${BRANCH_TARGET.branch}:${BRANCH_TARGET.relPath}`]: {
        code: 0,
        stdout: `# Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${proseSteps.join(", ")}\n`,
      },
    };
    if (stateSteps) {
      answers[`log -1 --format=%H refs/remotes/origin/${BRANCH_TARGET.branch} -- ${jsonPath}`] = {
        code: 0,
        stdout: "cafef00d1234\n",
      };
      answers[`show refs/remotes/origin/${BRANCH_TARGET.branch}:${jsonPath}`] = {
        code: 0,
        stdout: JSON.stringify({
          completedPhases: stateSteps,
          archived: null,
          reopened: null,
          acceptanceCriteria: [],
          phaseCounts: {},
        }),
      };
    }
    return fakeGit(answers);
  };

  /** A `WorkflowHistoryChecker` already warmed with `history`, ready to
   *  `peekHistory` without spawning git again. */
  const warmedHistory = async (...subjects: string[]): Promise<WorkflowHistoryChecker> => {
    const checker = new WorkflowHistoryChecker({ run: gitLogging(...subjects).run });
    await checker.read(DIR, FOLDER);
    return checker;
  };

  /** A `BranchFileStepsChecker` already warmed against `BRANCH_TARGET`.
   *  `stateSteps` is absent for a branch with no `4-status.json` yet
   *  (REQ-2's unchanged fallback), and given for the state-file cases
   *  (REQ-1/REQ-3/REQ-4). */
  const warmedBranchSteps = async (proseSteps: string[], stateSteps?: string[]): Promise<BranchFileStepsChecker> => {
    const checker = new BranchFileStepsChecker({ run: branchFileFake(proseSteps, stateSteps).run });
    await checker.read(DIR, FOLDER, BRANCH_TARGET);
    return checker;
  };

  /** A `BranchFileStepsChecker` warmed with no open branch — the caller's
   *  own cue to fall back to the disk read. */
  const warmedNoBranch = async (): Promise<BranchFileStepsChecker> => {
    const checker = new BranchFileStepsChecker({ run: fakeGit({}).run });
    await checker.read(DIR, FOLDER, null);
    return checker;
  };

  test("matching disk history and branch-file steps agree with stepsFileDisagreesOn's own answer", async () => {
    const history = await warmedHistory(subject("analyze"), subject("create"));
    const branchFileSteps = await warmedBranchSteps(["create", "analyze"]);
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, undefined);
    expect(resolved).not.toBeNull();
    expect(resolved!.done).toEqual(["create", "analyze"]);
    expect(resolved!.fileDisagrees).toEqual([]);
  });

  test("a spec with no create commit still resolves create as done", async () => {
    const history = await warmedHistory(subject("analyze"));
    const branchFileSteps = await warmedNoBranch();
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, {
      proseSteps: ["analyze"],
      stateSteps: undefined,
    });
    expect(resolved!.done).toEqual(["create", "analyze"]);
  });

  test("a spec peekHistory has not answered for resolves null", () => {
    const history = new WorkflowHistoryChecker({ run: gitLogging(subject("analyze")).run });
    const branchFileSteps = new BranchFileStepsChecker({ run: fakeGit({}).run });
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, undefined);
    expect(resolved).toBeNull();
  });

  test("an open branch's file steps are preferred over the disk copy", async () => {
    const history = await warmedHistory(subject("create"), subject("analyze"));
    const branchFileSteps = await warmedBranchSteps(["create", "analyze"]);
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, {
      proseSteps: ["create"],
      stateSteps: undefined,
    });
    expect(resolved!.fileSteps).toEqual(["create", "analyze"]);
  });

  // The risk this spec's own Risk analysis flags: `history` and
  // `branchFileSteps` swapped at the one call site. Built so each
  // checker's own answer is a DIFFERENT, recognizable value — `done` could
  // only come from `history`, `fileSteps` only from `branchFileSteps` — so
  // a parameter-order bug produces a visibly wrong `done` or `fileSteps`
  // rather than passing by coincidence.
  test("done and fileSteps are each traceable to their own checker, not swappable by coincidence", async () => {
    const history = await warmedHistory(subject("create"), subject("implement"));
    const branchFileSteps = await warmedBranchSteps(["create", "analyze"]);
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, {
      proseSteps: [],
      stateSteps: undefined,
    });
    expect(resolved!.done).toEqual(["create", "implement"]);
    expect(resolved!.fileSteps).toEqual(["create", "analyze"]);
  });

  // REQ-1/REQ-4/REQ-5, spec 349's own incident: git has no `analyze`
  // commit (an amended, unpushed commit) but the branch's own
  // `4-status.json` already has the phase. `done` and `fileDisagrees`
  // both read from the state file, not from git.
  test("REQ-1/REQ-4: done and fileDisagrees come from the branch's own state file, not git, once one exists", async () => {
    const history = await warmedHistory(subject("create"));
    const branchFileSteps = await warmedBranchSteps(["create", "analyze"], ["create", "analyze"]);
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, undefined);
    expect(resolved!.done).toEqual(["create", "analyze"]);
    expect(resolved!.fileDisagrees).toEqual([]);
  });

  // REQ-3: with a state file present, the one disagreement still
  // reported is prose claiming a phase the state file lacks — proven
  // here by git DISAGREEING with the state file too (git has
  // `implement`), so the assertion cannot pass by prose-vs-git
  // coincidentally agreeing.
  test("REQ-3: flags a phase the prose claims that the branch's own state file lacks", async () => {
    const history = await warmedHistory(subject("create"), subject("analyze"), subject("implement"));
    const branchFileSteps = await warmedBranchSteps(["create", "analyze", "implement"], ["create", "analyze"]);
    const resolved = resolveWorkflowState(history, branchFileSteps, DIR, FOLDER, undefined, undefined);
    expect(resolved!.fileDisagrees).toEqual(["implement"]);
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

// --- spec 198: history before the reopen boundary does not count -------------
//
// An archived spec that has to be done again is reopened, and the
// commits from the earlier round stay in the repository — they happened,
// and the archive is a record. What changes is that everything counting
// steps starts from the mark rather than from the folder's whole
// history. `--not <sha>` is the mechanism: it excludes every commit
// REACHABLE from the mark, which is exactly the earlier round, since the
// mark is the specs repo's default-branch tip at the moment of
// reopening.

const BOUNDARY = "1d0fe79cafe";

describe("workflowLogArgs with a reopen boundary", () => {
  test("no boundary: asks exactly what it asked before the boundary existed", () => {
    expect(workflowLogArgs(FOLDER)).not.toContain("--not");
  });

  test("with a boundary: excludes everything reachable from the mark", () => {
    const args = workflowLogArgs(FOLDER, BOUNDARY);
    expect(args).toContain("--not");
    expect(args).toContain(BOUNDARY);
    // `--not` alone names no positive rev, and git then walks nothing at
    // all. The exclusion has to follow `--all`, never replace it.
    expect(args.indexOf("--all")).toBeLessThan(args.indexOf("--not"));
  });
});

describe("WorkflowHistoryChecker with a reopen boundary", () => {
  test("passes the boundary on to git", async () => {
    const git = gitLogging();
    const checker = new WorkflowHistoryChecker({ run: git.run });
    await checker.read(DIR, FOLDER, BOUNDARY);
    expect(git.calls[0]!.args).toContain("--not");
    expect(git.calls[0]!.args).toContain(BOUNDARY);
  });

  // The cache is keyed on the question, and the boundary is part of it:
  // a spec reopened while the dashboard is running would otherwise keep
  // answering from the pre-reopen entry for the whole TTL — which is
  // exactly the "everything shows done" the reopen exists to end.
  test("a spec asked with and without a boundary is two questions", async () => {
    const git = gitLogging(subject("analyze"));
    const checker = new WorkflowHistoryChecker({ run: git.run, now: () => 0 });
    await checker.read(DIR, FOLDER);
    await checker.read(DIR, FOLDER, BOUNDARY);
    expect(git.calls.length).toBe(2);
  });
});

describe("WorkflowHistoryChecker boundary against real git", () => {
  test("the earlier round is not counted, and the new round still is", async () => {
    const repo = mkdtempSync(join(tmpdir(), "aide-reopen-"));
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "config", "user.name", "Test");
    gitIn(repo, "config", "user.email", "test@example.com");
    const specDir = join(repo, FOLDER);
    mkdirSync(specDir);
    writeFileSync(join(specDir, "1-description.md"), "# spec\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-qm", subject("create"));
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", subject("analyze"));
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", subject("implement"));
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", subject("archive"));
    const boundary = gitIn(repo, "rev-parse", "HEAD").stdout.toString().trim();

    const checker = new WorkflowHistoryChecker({ run: createGitRunner(), ttlMs: 0 });
    expect((await checker.read(specDir, FOLDER)).done).toEqual([
      "create", "analyze", "implement", "archive",
    ]);
    // Reopened: nothing has run in the new round.
    expect(await checker.read(specDir, FOLDER, boundary)).toEqual({ done: [], stopped: {} });

    // And the new round's own analyze, made after the mark, still counts.
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", subject("analyze"));
    expect((await checker.read(specDir, FOLDER, boundary)).done).toEqual(["analyze"]);
  });
});
