// The Checks tab writes a tick to `aide/<folder>` when that branch is
// open (spec-edit.ts, REQ-4), and the disk copy stays unticked until
// archive lands. Both the queue's archive hold-back and the row's
// "archive held back" used to read disk alone, and held a spec whose
// every row was ticked (364, 2026-09-03). Both now read the branch copy
// the schedule keeps, and fall back to disk only without one.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchFileStepsChecker } from "../../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { blockedForMissingAnalyze, blockedForUntickedAcceptance, type ScheduleContext } from "../../../src/serve/schedules.ts";
import { targets, type SpecLookupContext } from "../../../src/serve/spec-lookup.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../src/project/parse-status.ts";

const FOLDER = "81-queue-and-runner";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A projects root whose one spec is implemented, with its acceptance
 *  row UNTICKED on disk. */
function projectsRoot(): { root: string; specDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-acceptance-branch-"));
  dirs.push(dir);
  const root = join(dir, "root");
  const project = join(root, "aide");
  const specDir = join(project, "specs", FOLDER);
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "1-description.md"), "# Queue - Description\n");
  writeFileSync(
    join(specDir, "4-status.md"),
    "# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** analyze, implement\n\n" +
      "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n| REQ-1: it works | ⬜ | |\n",
  );
  writeFileSync(
    join(specDir, "4-status.json"),
    JSON.stringify({ completedPhases: ["analyze", "implement"], archived: null, reopened: null,
      acceptanceCriteria: [{ task: "REQ-1: it works", done: false }], phaseCounts: {} }),
  );
  return { root, specDir };
}

/** A checker that has read the branch copy, where the row IS ticked. */
async function warmedChecker(specDir: string, done: boolean): Promise<BranchFileStepsChecker> {
  const target: OpenBranchTarget = {
    root: "/root",
    branch: `aide/${FOLDER}`,
    relPath: `aide/specs/${FOLDER}/4-status.md`,
    archivedRelPath: `aide/specs/archive/${FOLDER}/4-status.md`,
  };
  const run: GitRunner = async (_dir, args) => {
    const line = args.join(" ");
    if (line.startsWith("fetch")) return { code: 0, stdout: "" };
    if (line.startsWith("log -1")) return { code: 0, stdout: "deadbeef\n" };
    if (line.endsWith("4-status.md")) {
      return { code: 0, stdout: "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** analyze, implement\n" };
    }
    if (line.endsWith("4-status.json")) {
      return {
        code: 0,
        stdout: JSON.stringify({ completedPhases: ["analyze", "implement"], archived: null, reopened: null,
          acceptanceCriteria: [{ task: "REQ-1: it works", done }], phaseCounts: {} }),
      };
    }
    return { code: 1, stdout: "" };
  };
  const checker = new BranchFileStepsChecker({ run });
  await checker.read(specDir, FOLDER, target);
  return checker;
}

const queuedArchive = { id: "job-1", project: "aide", specFolder: FOLDER, state: "queued", steps: ["archive"], stepIndex: 0 };

function scheduleCtx(root: string, checker: BranchFileStepsChecker): ScheduleContext {
  return {
    projectRoot: root,
    queue: { list: () => [queuedArchive] },
    readBranchFileSteps: () => checker,
  } as unknown as ScheduleContext;
}

describe("the queue's archive hold-back", () => {
  test("reads the branch copy first: every row ticked there releases the job", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, true);
    expect(blockedForUntickedAcceptance(scheduleCtx(root, checker)).has("job-1")).toBe(false);
  });

  test("an open row on the branch holds the job", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, false);
    expect(blockedForUntickedAcceptance(scheduleCtx(root, checker)).has("job-1")).toBe(true);
  });

  test("with no branch answer, disk decides", () => {
    const { root } = projectsRoot();
    const checker = new BranchFileStepsChecker({ run: async () => ({ code: 1, stdout: "" }) });
    expect(blockedForUntickedAcceptance(scheduleCtx(root, checker)).has("job-1")).toBe(true);
  });
});

function lookupCtx(root: string, checker: BranchFileStepsChecker | undefined): SpecLookupContext {
  return {
    projectRoot: root,
    allowed: new Set(["aide"]),
    ownedSpecsRoot: () => undefined,
    readScan: () => null,
    writeScan: () => {},
    branchStatus: { peekOpenSpecBranches: () => ({ open: null }) },
    readBranchFileSteps: () => checker,
  } as unknown as SpecLookupContext;
}

describe("the row's own archive held back", () => {
  test("is not said over a spec whose rows are ticked on its branch", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, true);
    const target = targets(lookupCtx(root, checker)).find((t) => t.specFolder === FOLDER);
    expect(target?.archiveHeldBack).toBeUndefined();
  });

  test("is said off disk when no branch answer exists", () => {
    const { root } = projectsRoot();
    const target = targets(lookupCtx(root, undefined)).find((t) => t.specFolder === FOLDER);
    expect(target?.archiveHeldBack?.reason).toBe(ACCEPTANCE_CRITERIA_UNTICKED_NOTE);
  });
});

// The branch answer is TTL-cached, and a tick that lands on the default
// branch used to leave it saying "still open" for the rest of that
// window (337, 2026-09-04). That was answered by letting the disk copy's
// "all ticked" outvote it — safe only while a tick could ONLY ever be
// added. A check can be taken back off now, and that rule let an untick
// on the branch be outvoted by a disk copy ticked before the branch
// existed, which is archive starting on a spec the reader had just
// reopened the question on.
//
// So the branch answers for both when it has one, and 337 is answered
// where it actually arises: the tick route drops the cached answer in
// the same request that writes the file
// (`forgetBranchFileSteps`, spec-edit/checks.ts), so no answer from
// before a Save can be served after it. The case below is that stale
// answer constructed by hand, which no route can now produce — and the
// branch still decides.
describe("a branch answer that predates a tick landed on disk", () => {
  /** The disk copy with its one acceptance row TICKED — the Save has
   *  landed there, while the cached branch answer predates it. */
  function tickedOnDisk(specDir: string): void {
    writeFileSync(
      join(specDir, "4-status.json"),
      JSON.stringify({ completedPhases: ["analyze", "implement"], archived: null, reopened: null,
        acceptanceCriteria: [{ task: "REQ-1: it works", done: true }], phaseCounts: {} }),
    );
  }

  test("the branch decides, so the queued archive waits", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, false);
    tickedOnDisk(specDir);
    expect(blockedForUntickedAcceptance(scheduleCtx(root, checker)).has("job-1")).toBe(true);
  });

  test("the row says archive is held back for the same reason", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, false);
    tickedOnDisk(specDir);
    const target = targets(lookupCtx(root, checker)).find((t) => t.specFolder === FOLDER);
    expect(target?.archiveHeldBack?.reason).toBe(ACCEPTANCE_CRITERIA_UNTICKED_NOTE);
  });

  // The route's own answer to the same situation: the cached branch
  // answer is dropped by the write, so the next read asks git rather
  // than repeating what was true before the Save.
  test("no branch answer at all: disk decides, and a ticked disk holds nothing", async () => {
    const { root, specDir } = projectsRoot();
    tickedOnDisk(specDir);
    // An empty checker is what `forget` leaves behind: no answer, so the
    // read falls through to disk.
    const empty = new BranchFileStepsChecker({} as never);
    expect(blockedForUntickedAcceptance(scheduleCtx(root, empty)).has("job-1")).toBe(false);
    const target = targets(lookupCtx(root, undefined)).find((t) => t.specFolder === FOLDER);
    expect(target?.archiveHeldBack).toBeUndefined();
  });
});

// The same for the analyze gate: a chained job's analyze is on the
// branch the moment the step ends, and its landing can fail (main moved
// under it) without the analysis being any less done — implement runs
// from that branch. Read off disk alone, the job sat queued behind
// "held back: not analyzed yet" with the real reason only in
// landingError (2026-09-03).
describe("the queue's analyze gate", () => {
  const queuedImplement = { id: "job-2", project: "aide", specFolder: FOLDER, state: "queued", steps: ["implement"], stepIndex: 0 };
  function ctxFor(root: string, checker: BranchFileStepsChecker): ScheduleContext {
    return {
      projectRoot: root,
      queue: { list: () => [queuedImplement] },
      readBranchFileSteps: () => checker,
    } as unknown as ScheduleContext;
  }
  /** Disk says nothing has run; the branch copy names analyze. */
  function unanalyzedOnDisk(): { root: string; specDir: string } {
    const made = projectsRoot();
    writeFileSync(
      join(made.specDir, "4-status.json"),
      JSON.stringify({ completedPhases: [], archived: null, reopened: null, acceptanceCriteria: [], phaseCounts: {} }),
    );
    return made;
  }

  test("reads the branch copy first: analyze on the branch releases implement", async () => {
    const { root, specDir } = unanalyzedOnDisk();
    const checker = await warmedChecker(specDir, true);
    expect(blockedForMissingAnalyze(ctxFor(root, checker)).has("job-2")).toBe(false);
  });

  test("with no branch answer, disk decides", () => {
    const { root } = unanalyzedOnDisk();
    const checker = new BranchFileStepsChecker({ run: async () => ({ code: 1, stdout: "" }) });
    expect(blockedForMissingAnalyze(ctxFor(root, checker)).has("job-2")).toBe(true);
  });
});
