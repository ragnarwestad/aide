// One reader for a spec's completed phases and its acceptance state: the
// branch copy when it has been read and no write has marked it due, the
// copy on main otherwise. The specs list, the runner's holds and the Run
// route all ask it, so for the same caches they give the same answer.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BranchFileStepsChecker, WorkflowHistoryChecker, resolveWorkflowState, type FileStepsAnswer,
} from "../../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import type { SpecStateAcceptanceRow } from "../../../src/project/parse-spec-state.ts";
import { readSpecProgress, specProgressOf } from "../../../src/serve/schedules/spec-progress.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const FOLDER = "81-queue-and-runner";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const TARGET: OpenBranchTarget = {
  root: "/root",
  branch: `aide/${FOLDER}`,
  relPath: `aide/specs/${FOLDER}/4-status.md`,
  archivedRelPath: `aide/specs/archive/${FOLDER}/4-status.md`,
};
const JSON_PATH = TARGET.relPath.replace(/4-status\.md$/, "4-status.json");

const status = (steps: string[], rows = "") =>
  `# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${steps.join(", ")}\n\n` +
  (rows ? `## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n${rows}` : "");
const state = (phases: string[], rows: SpecStateAcceptanceRow[] = []) =>
  JSON.stringify({ completedPhases: phases, archived: null, reopened: null, acceptanceCriteria: rows, phaseCounts: {} });

/** The spec's folder on main: its prose and, when given, its state file. */
function specOnMain(prose: string, stateFile?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-spec-progress-"));
  dirs.push(dir);
  const specDir = join(dir, FOLDER);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "4-status.md"), prose);
  if (stateFile) writeFileSync(join(specDir, "4-status.json"), stateFile);
  return specDir;
}

/** A branch checker that has read the open branch's copy. */
async function branchRead(dir: string, prose: string, stateFile?: string): Promise<BranchFileStepsChecker> {
  const answers: Record<string, { code: number; stdout?: string }> = {
    "fetch --quiet origin": { code: 0 },
    [`log -1 --format=%H refs/remotes/origin/${TARGET.branch} -- ${TARGET.relPath}`]: { code: 0, stdout: "deadbeef\n" },
    [`show refs/remotes/origin/${TARGET.branch}:${TARGET.relPath}`]: { code: 0, stdout: prose },
  };
  if (stateFile) {
    answers[`log -1 --format=%H refs/remotes/origin/${TARGET.branch} -- ${JSON_PATH}`] = { code: 0, stdout: "cafef00d\n" };
    answers[`show refs/remotes/origin/${TARGET.branch}:${JSON_PATH}`] = { code: 0, stdout: stateFile };
  }
  const checker = new BranchFileStepsChecker({ run: fakeGit(answers).run });
  await checker.read(dir, FOLDER, TARGET);
  return checker;
}

/** A branch checker that has read the spec and found no open branch. */
async function noBranch(dir: string): Promise<BranchFileStepsChecker> {
  const checker = new BranchFileStepsChecker({ run: fakeGit({}).run });
  await checker.read(dir, FOLDER, null);
  return checker;
}

/** A history checker that has read git's log, newest subject first. */
async function historyRead(dir: string, ...subjects: string[]): Promise<WorkflowHistoryChecker> {
  const checker = new WorkflowHistoryChecker({ run: fakeGit({ log: { code: 0, stdout: subjects.join("\n") + "\n" } }).run });
  await checker.read(dir, FOLDER);
  return checker;
}
const ran = (step: string, stopped?: string) => `Run /aide-${step} for ${FOLDER} (headless)${stopped ? ` (stopped: ${stopped})` : ""}`;

/** What the specs list's own rule answers for the same caches and disk copy. */
function listAnswer(history: WorkflowHistoryChecker, branch: BranchFileStepsChecker, dir: string, disk: FileStepsAnswer) {
  return resolveWorkflowState(history, branch, dir, FOLDER, undefined, disk)?.done;
}

describe("the phases a spec has completed, asked by every reader", () => {
  test("a settled branch copy ahead of main answers for the list and the reader alike (AC-1)", async () => {
    const dir = specOnMain(status(["create", "analyze"]), state(["create", "analyze"]));
    const branch = await branchRead(dir, status(["create", "analyze", "implement"]), state(["create", "analyze", "implement"]));
    const history = await historyRead(dir, ran("implement"), ran("analyze"), ran("create"));
    const progress = readSpecProgress({ readBranchFileSteps: () => branch, readWorkflowHistory: () => history }, dir, FOLDER);
    expect(progress.completedPhases).toEqual(["create", "analyze", "implement"]);
    expect(listAnswer(history, branch, dir, { proseSteps: ["create", "analyze"], stateSteps: ["create", "analyze"] }))
      .toEqual(progress.completedPhases);
  });

  test("with no state file, git history counts a phase main's prose has not got (AC-1)", async () => {
    const dir = specOnMain(status(["create", "analyze"]));
    const branch = await noBranch(dir);
    const history = await historyRead(dir, ran("implement"), ran("analyze"), ran("create"));
    const progress = readSpecProgress({ readBranchFileSteps: () => branch, readWorkflowHistory: () => history }, dir, FOLDER);
    expect(progress.completedPhases).toContain("implement");
    expect(listAnswer(history, branch, dir, { proseSteps: ["create", "analyze"], stateSteps: undefined }))
      .toEqual(progress.completedPhases);
  });

  test("a phase whose newest run failed is not done, though main's record names it (AC-1)", async () => {
    const dir = specOnMain(status(["create", "analyze", "implement"]), state(["create", "analyze", "implement"]));
    const branch = await noBranch(dir);
    const history = await historyRead(dir, ran("implement", "model-refused"), ran("implement"), ran("analyze"), ran("create"));
    const progress = readSpecProgress({ readBranchFileSteps: () => branch, readWorkflowHistory: () => history }, dir, FOLDER);
    expect(progress.completedPhases).not.toContain("implement");
    expect(listAnswer(history, branch, dir, { proseSteps: [], stateSteps: ["create", "analyze", "implement"] }))
      .toEqual(progress.completedPhases);
  });

  test("a branch answer a write has marked due gives way to main, and the answer is not settled (AC-2)", async () => {
    const dir = specOnMain(status(["create"]), state(["create"]));
    const branch = await branchRead(dir, status(["create", "analyze"]), state(["create", "analyze"]));
    branch.forget(dir, FOLDER);
    const progress = readSpecProgress({ readBranchFileSteps: () => branch }, dir, FOLDER);
    expect(progress.completedPhases).toEqual(["create"]);
    expect(progress.from).toBe("main");
    expect(progress.settled).toBe(false);
  });

  test("a branch answer read and not marked due answers, settled (AC-2)", async () => {
    const dir = specOnMain(status(["create"]), state(["create"]));
    const branch = await branchRead(dir, status(["create", "analyze"]), state(["create", "analyze"]));
    const progress = readSpecProgress({ readBranchFileSteps: () => branch }, dir, FOLDER);
    expect(progress.completedPhases).toEqual(["create", "analyze"]);
    expect(progress.from).toBe("branch");
    expect(progress.settled).toBe(true);
    // Whether the work has reached main is a question of its own.
    expect(progress.onMain).toEqual(["create"]);
  });
});

describe("a spec's acceptance state, off one source", () => {
  const open: SpecStateAcceptanceRow = { task: "AC-1: it works", done: false };
  const ticked: SpecStateAcceptanceRow = { task: "AC-1: it works", done: true };

  test("the state file's rows decide, though the prose beside it shows a row open (AC-3)", () => {
    const disk: FileStepsAnswer = { proseSteps: [], stateSteps: ["create"], stateAcceptance: [ticked], acceptance: [] };
    expect(specProgressOf(disk, { steps: null, checkedAt: 1 }, null).acceptanceOpen).toBe(false);
  });

  test("a branch copy with no state file has no open row, whatever its prose says (AC-3)", async () => {
    const dir = specOnMain(status(["create", "analyze", "implement"]), state(["create", "analyze", "implement"], [ticked]));
    const branch = await branchRead(dir, status(["create", "analyze", "implement"], "| AC-1: it works | ⬜ | |\n"));
    expect(readSpecProgress({ readBranchFileSteps: () => branch }, dir, FOLDER).acceptanceOpen).toBe(false);
  });

  test("an open row in the answering copy's state file is open (AC-3)", () => {
    const disk: FileStepsAnswer = { proseSteps: [], stateSteps: ["create"], stateAcceptance: [open] };
    expect(specProgressOf(disk, { steps: null, checkedAt: 1 }, null).acceptanceOpen).toBe(true);
  });

  test("a Not verified row is not open (AC-3)", () => {
    const disk: FileStepsAnswer = { proseSteps: [], stateSteps: ["create"], stateAcceptance: [{ ...ticked, notVerified: true }] };
    expect(specProgressOf(disk, { steps: null, checkedAt: 1 }, null).acceptanceOpen).toBe(false);
  });

  test("Not verified and Failed are counted off the same state file rows (AC-3)", () => {
    const branch: FileStepsAnswer = {
      proseSteps: [], stateSteps: ["create"],
      stateAcceptance: [{ task: "AC-1", done: true, notVerified: true }, { task: "AC-2", done: false, failed: true }, ticked],
      acceptance: [],
    };
    const progress = specProgressOf({ proseSteps: [], stateSteps: undefined }, { steps: branch, checkedAt: 1 }, null);
    expect([progress.notVerified, progress.failed]).toEqual([1, 1]);
  });
});
