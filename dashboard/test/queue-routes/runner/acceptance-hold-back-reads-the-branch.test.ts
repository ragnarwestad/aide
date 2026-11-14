// The Checks tab writes a tick to `aide/<folder>` when that branch is
// open (spec-edit.ts), and the disk copy stays unticked until
// archive lands. Reading disk alone would hold a spec whose every row
// was ticked, so both the queue's archive hold-back and the row's
// "archive held back" read the branch copy the schedule keeps, and fall
// back to disk only without one.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BranchFileStepsChecker, WorkflowHistoryChecker } from "../../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import type { GitRunner } from "../../../src/git/process/index.ts";
import { archiveWithOpenAcceptance, blockedForMissingAnalyze, type ScheduleContext } from "../../../src/serve/schedules";
import { targets, type SpecLookupContext } from "../../../src/serve/spec-lookup.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../src/project/parse-status";
import { fakeGit } from "../../helpers/fake-git.ts";

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
async function warmedChecker(specDir: string, done: boolean, phases = ["analyze", "implement"]): Promise<BranchFileStepsChecker> {
  return warmedWith(
    specDir,
    `# Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${phases.join(", ")}\n\n` +
      "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n" +
      `| REQ-1: it works on the branch | ${done ? "✅" : "⬜"} | |\n`,
    JSON.stringify({ completedPhases: phases, archived: null, reopened: null,
      acceptanceCriteria: [{ task: "REQ-1: it works", done }], phaseCounts: {} }),
  );
}

/** A checker that has read this branch copy of 4-status.md and 4-status.json. */
async function warmedWith(specDir: string, prose: string, stateFile: string): Promise<BranchFileStepsChecker> {
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
    if (line.endsWith("4-status.md")) return { code: 0, stdout: prose };
    if (line.endsWith("4-status.json")) return { code: 0, stdout: stateFile };
    return { code: 1, stdout: "" };
  };
  const checker = new BranchFileStepsChecker({ run });
  await checker.read(specDir, FOLDER, target);
  return checker;
}

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

// The Specs list unfolds these rows, so they ride on the target.
describe("the rows the list unfolds", () => {
  test("the target's rows are the branch's when it has an answer", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, false);
    const target = targets(lookupCtx(root, checker)).find((t) => t.specFolder === FOLDER);
    expect(target?.acceptance?.map((r) => r.task)).toEqual(["REQ-1: it works on the branch"]);
  });

  test("and the checkout's own file otherwise", () => {
    const { root } = projectsRoot();
    const target = targets(lookupCtx(root, undefined)).find((t) => t.specFolder === FOLDER);
    expect(target?.acceptance?.map((r) => r.task)).toEqual(["REQ-1: it works"]);
  });

  test("a spec whose rows are all ticked, one of them Not verified, carries them", () => {
    const { root, specDir } = projectsRoot();
    writeFileSync(
      join(specDir, "4-status.md"),
      "# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** analyze, implement\n\n" +
        "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n| REQ-1: it works | Not verified | needs production |\n",
    );
    writeFileSync(
      join(specDir, "4-status.json"),
      JSON.stringify({ completedPhases: ["analyze", "implement"], archived: null, reopened: null,
        acceptanceCriteria: [{ task: "REQ-1: it works", done: true, notVerified: true }], phaseCounts: {} }),
    );
    const target = targets(lookupCtx(root, undefined)).find((t) => t.specFolder === FOLDER);
    expect(target?.notVerified).toBe(1);
    expect(target?.acceptance?.map((r) => r.task)).toEqual(["REQ-1: it works"]);
  });

  test("Not verified and Failed are counted off the branch's state file, not its prose (AC-3)", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedWith(
      specDir,
      "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** analyze, implement\n\n" +
        "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n| REQ-1: one | ✅ | |\n| REQ-2: two | ✅ | |\n",
      JSON.stringify({ completedPhases: ["analyze", "implement"], archived: null, reopened: null, phaseCounts: {},
        acceptanceCriteria: [{ task: "REQ-1: one", done: true, notVerified: true }, { task: "REQ-2: two", done: false, failed: true }] }),
    );
    const target = targets(lookupCtx(root, checker)).find((t) => t.specFolder === FOLDER);
    expect([target?.notVerified, target?.failed]).toEqual([1, 1]);
  });

  test("a spec with no open criterion carries none", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, true);
    const target = targets(lookupCtx(root, checker)).find((t) => t.specFolder === FOLDER);
    expect(target?.acceptance).toBeUndefined();
  });
});

// The branch answer is TTL-cached, and a tick that lands on the default
// branch used to leave it saying "still open" for the rest of that
// window. That was answered by letting the disk copy's
// "all ticked" outvote it — safe only while a tick could ONLY ever be
// added. A check can be taken back off now, and that rule let an untick
// on the branch be outvoted by a disk copy ticked before the branch
// existed, which is archive starting on a spec the reader had just
// reopened the question on.
//
// So the branch answers for both when it has one, and 337 is answered
// where it actually arises: the tick route drops the cached answer in
// the same request that writes the file
// (`forgetSpec`, through `afterTick` in spec-edit/checks.ts), so no answer from
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
    new BranchFileStepsChecker({} as never);
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
  function ctxFor(root: string, checker: BranchFileStepsChecker, opts: Partial<ScheduleContext> = {}): ScheduleContext {
    return {
      projectRoot: root,
      queue: { list: () => [queuedImplement] },
      readBranchFileSteps: () => checker,
      targets: () => [],
      readScan: () => null,
      ...opts,
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

  test("a branch answer a write has marked due gives way to main, and main holds it (AC-2)", async () => {
    const { root, specDir } = unanalyzedOnDisk();
    const checker = await warmedChecker(specDir, true, ["create", "analyze"]);
    checker.forget(specDir, FOLDER);
    expect(blockedForMissingAnalyze(ctxFor(root, checker)).has("job-2")).toBe(true);
  });

  // On the serving host the caches are warmed under the dashboard's own
  // checkout, while the scan of the projects root finds the person's own.
  test("reads the branch answer under the folder the caches are keyed by (AC-2)", async () => {
    const { root } = unanalyzedOnDisk();
    const checkout = join(dirname(root), "checkout", FOLDER);
    mkdirSync(checkout, { recursive: true });
    const checker = await warmedChecker(checkout, true, ["create", "analyze"]);
    const readScan = () => ({ archived: [], dirs: new Map([[`aide/${FOLDER}`, checkout]]) });
    expect(blockedForMissingAnalyze(ctxFor(root, checker, { readScan })).has("job-2")).toBe(false);
  });

  test("with no state file, the git history counts an analyze main's prose has not got (AC-1)", async () => {
    const { root, specDir } = projectsRoot();
    rmSync(join(specDir, "4-status.json"));
    writeFileSync(join(specDir, "4-status.md"), "# Queue - Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n");
    const checker = new BranchFileStepsChecker({ run: fakeGit({}).run });
    await checker.read(specDir, FOLDER, null);
    const history = new WorkflowHistoryChecker({
      run: fakeGit({ log: { code: 0, stdout: `Run /aide-analyze for ${FOLDER} (headless)\nRun /aide-create for ${FOLDER} (headless)\n` } }).run,
    });
    await history.read(specDir, FOLDER);
    expect(blockedForMissingAnalyze(ctxFor(root, checker, { readWorkflowHistory: () => history })).has("job-2")).toBe(false);
  });
});

// A queued archive the script would only refuse is ended by the runner
// — but only on a branch answer read since the last
// tick, since the Checks tab ticks the branch and disk lags behind it.
describe("the queue's unticked-archive check", () => {
  const queuedArchive = { id: "job-3", project: "aide", specFolder: FOLDER, state: "queued", steps: ["implement", "archive"], stepIndex: 1 };
  function ctxFor(root: string, checker: BranchFileStepsChecker, opts: Partial<ScheduleContext> = {}): ScheduleContext {
    return {
      projectRoot: root,
      queue: { list: () => [queuedArchive] },
      readBranchFileSteps: () => checker,
      targets: () => [],
      readScan: () => null,
      ...opts,
    } as unknown as ScheduleContext;
  }

  test("an open row on the branch names the job", async () => {
    const { root, specDir } = projectsRoot();
    expect(archiveWithOpenAcceptance(ctxFor(root, await warmedChecker(specDir, false))).has("job-3")).toBe(true);
  });

  test("every row ticked on the branch leaves it to start, though disk is unticked", async () => {
    const { root, specDir } = projectsRoot();
    expect(archiveWithOpenAcceptance(ctxFor(root, await warmedChecker(specDir, true))).has("job-3")).toBe(false);
  });

  test("an unread branch answer decides nothing: the script's own pre-check does", () => {
    const { root } = projectsRoot();
    const checker = new BranchFileStepsChecker({ run: async () => ({ code: 1, stdout: "" }) });
    expect(archiveWithOpenAcceptance(ctxFor(root, checker)).has("job-3")).toBe(false);
  });

  // Implement never ran — it was taken out of the job while analyze ran
  //. The script says so first; ended here, the row read
  // "acceptance criteria unticked", true but not the reason.
  test("a spec implement has not run on is left to the script, which says so", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, false, ["analyze"]);
    expect(archiveWithOpenAcceptance(ctxFor(root, checker)).has("job-3")).toBe(false);
  });

  test("an answer a tick has marked stale decides nothing either", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, false);
    checker.forget(specDir, FOLDER);
    expect(archiveWithOpenAcceptance(ctxFor(root, checker)).has("job-3")).toBe(false);
  });

  // Main reads unticked while the tick sits on the branch: an answer a
  // write has marked due is not read off main here, since this hold ends the job.
  test("a due branch answer ticked, over an open row on main, ends nothing (AC-2)", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await warmedChecker(specDir, true);
    checker.forget(specDir, FOLDER);
    expect(archiveWithOpenAcceptance(ctxFor(root, checker)).has("job-3")).toBe(false);
  });

  test("an implement whose newest run failed is not reached, though main's record names it (AC-1)", async () => {
    const { root, specDir } = projectsRoot();
    const checker = new BranchFileStepsChecker({ run: fakeGit({}).run });
    await checker.read(specDir, FOLDER, null);
    const history = new WorkflowHistoryChecker({
      run: fakeGit({ log: { code: 0, stdout: [
        `Run /aide-implement for ${FOLDER} (headless) (stopped: model-refused)`,
        `Run /aide-implement for ${FOLDER} (headless)`, `Run /aide-analyze for ${FOLDER} (headless)`,
      ].join("\n") + "\n" } }).run,
    });
    await history.read(specDir, FOLDER);
    expect(archiveWithOpenAcceptance(ctxFor(root, checker, { readWorkflowHistory: () => history })).has("job-3")).toBe(false);
  });
});
