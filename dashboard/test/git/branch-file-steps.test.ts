// Spec 298: the file half of `stepsFileDisagreesOn`'s comparison, read
// from a spec's own open `aide/<folder>` branch instead of the
// default-branch checkout's stale copy — the same point in the graph the
// history half (`WorkflowHistoryChecker`) already answers from.
//
// Shaped exactly like `WorkflowHistoryChecker`: an async `read`, TTL
// cached, and a synchronous `peekFileSteps` a render may call without
// ever spawning git. `target: null` (no open branch) is the caller's own
// cue — `warmSpec` has already asked `resolveOpenBranchTarget` — so this
// class never resolves a branch itself, only reads one.

import { describe, expect, test } from "bun:test";
import { BranchFileStepsChecker } from "../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../src/git/branch-file.ts";
import type { GitRunner } from "../../src/git/branch-status.ts";

const DIR = "/specs/aide/298-example";
const FOLDER = "298-example";
const TARGET: OpenBranchTarget = {
  root: "/root",
  branch: `aide/${FOLDER}`,
  relPath: `aide/specs/${FOLDER}/4-status.md`,
  archivedRelPath: `aide/specs/archive/${FOLDER}/4-status.md`,
};

const fake = (answers: Record<string, { code: number; stdout?: string }>): { run: GitRunner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: GitRunner = async (_dir, args) => {
    calls.push(args);
    const line = args.join(" ");
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
    }
    return { code: 1, stdout: "" };
  };
  return { run, calls };
};

const JSON_PATH = TARGET.relPath.replace(/4-status\.md$/, "4-status.json");

/** What `readStatusFromBranch` needs answered, for a branch whose
 *  `4-status.md` names `proseSteps`. `stateSteps`, when given, is what
 *  the branch's own sibling `4-status.json` answers with (spec 362) —
 *  keyed on the FULL show path, since a generic prefix cannot tell the
 *  `.md` request from the `.json` one apart. */
const branchFile = (proseSteps: string[], stateSteps?: string[]) => {
  const answers: Record<string, { code: number; stdout?: string }> = {
    "fetch --quiet origin": { code: 0 },
    [`log -1 --format=%H refs/remotes/origin/${TARGET.branch} -- ${TARGET.relPath}`]: {
      code: 0,
      stdout: "deadbeef1234\n",
    },
    [`show refs/remotes/origin/${TARGET.branch}:${TARGET.relPath}`]: {
      code: 0,
      stdout: `# Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${proseSteps.join(", ")}\n`,
    },
  };
  if (stateSteps) {
    answers[`log -1 --format=%H refs/remotes/origin/${TARGET.branch} -- ${JSON_PATH}`] = {
      code: 0,
      stdout: "cafef00d1234\n",
    };
    answers[`show refs/remotes/origin/${TARGET.branch}:${JSON_PATH}`] = {
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
  return answers;
};

describe("BranchFileStepsChecker", () => {
  test("an open branch whose file names steps resolves those steps", async () => {
    const git = fake(branchFile(["create", "analyze", "implement"]));
    const checker = new BranchFileStepsChecker({ run: git.run });
    const steps = await checker.read(DIR, FOLDER, TARGET);
    expect(steps).toEqual({ proseSteps: ["create", "analyze", "implement"], stateSteps: undefined, acceptanceOpen: false });
  });

  // REQ-1/REQ-4, the branch half of spec 349's own class of bug: the
  // branch's own `4-status.json` answers `stateSteps`, disagreeing with
  // its own prose — proving the state file, not the prose alone, is
  // what a caller reads once one exists on the branch.
  test("a branch whose own 4-status.json exists answers stateSteps from it", async () => {
    const git = fake(branchFile(["create", "analyze"], ["create", "analyze", "implement"]));
    const checker = new BranchFileStepsChecker({ run: git.run });
    const steps = await checker.read(DIR, FOLDER, TARGET);
    expect(steps).toEqual({
      proseSteps: ["create", "analyze"],
      stateSteps: ["create", "analyze", "implement"],
      acceptanceOpen: false,
    });
  });

  test("peekFileSteps hands back the read answer, spawning no git", async () => {
    const git = fake(branchFile(["analyze"]));
    const checker = new BranchFileStepsChecker({ run: git.run, now: () => 1000 });
    await checker.read(DIR, FOLDER, TARGET);
    const before = git.calls.length;
    const { steps, checkedAt } = checker.peekFileSteps(DIR, FOLDER);
    expect(steps).toEqual({ proseSteps: ["analyze"], stateSteps: undefined, acceptanceOpen: false });
    expect(checkedAt).toBe(1000);
    expect(git.calls.length).toBe(before);
  });

  // REQ-3's unit-level proof: no open branch is the caller's own cue to
  // fall back to the disk read, and this class must never resolve one
  // itself.
  test("no open branch resolves null, and spawns no git", async () => {
    const git = fake({});
    const checker = new BranchFileStepsChecker({ run: git.run });
    const steps = await checker.read(DIR, FOLDER, null);
    expect(steps).toBeNull();
    expect(git.calls.length).toBe(0);
    expect(checker.peekFileSteps(DIR, FOLDER).steps).toBeNull();
  });

  // A spec the warmer has not reached yet answers the same shape as one
  // with no open branch — the caller does not need to tell the two
  // apart, both mean "fall back to the disk read".
  test("a spec nothing has ever asked about answers null, and spawns no git", () => {
    const git = fake(branchFile(["create"]));
    const checker = new BranchFileStepsChecker({ run: git.run });
    expect(checker.peekFileSteps(DIR, FOLDER)).toEqual({ steps: null, checkedAt: null });
    expect(git.calls.length).toBe(0);
  });

  test("a second read inside the TTL window spawns no new git call", async () => {
    const git = fake(branchFile(["analyze"]));
    let clock = 0;
    const checker = new BranchFileStepsChecker({ run: git.run, now: () => clock });
    await checker.read(DIR, FOLDER, TARGET);
    const before = git.calls.length;
    await checker.read(DIR, FOLDER, TARGET);
    expect(git.calls.length).toBe(before);
    clock = 60_000;
    await checker.read(DIR, FOLDER, TARGET);
    expect(git.calls.length).toBeGreaterThan(before);
  });

  // The Checks tab writes onto the same branch this reads, so a Save
  // that ticks the last row leaves the cached answer wrong for the rest
  // of the TTL — which is how the row went on saying "held back: the
  // Acceptance criteria are not all ticked yet" straight after a Save
  // (337, 2026-09-04). `forget` is what the tick route calls.
  test("a forgotten spec is asked about git again inside the TTL window", async () => {
    const git = fake(branchFile(["analyze"]));
    let clock = 0;
    const checker = new BranchFileStepsChecker({ run: git.run, now: () => clock });
    await checker.read(DIR, FOLDER, TARGET);
    const before = git.calls.length;
    checker.forget(DIR, FOLDER);
    expect(checker.peekFileSteps(DIR, FOLDER)).toEqual({ steps: null, checkedAt: null });
    await checker.read(DIR, FOLDER, TARGET);
    expect(git.calls.length).toBeGreaterThan(before);
  });

  // The Risk analysis item 4 case this class itself can hit:
  // `readStatusFromBranch` throwing rather than answering with a
  // nonzero code.
  test("a throwing runner resolves null rather than rejecting", async () => {
    const checker = new BranchFileStepsChecker({
      run: async () => {
        throw new Error("no such directory");
      },
    });
    expect(await checker.read(DIR, FOLDER, TARGET)).toBeNull();
  });

  test("a branch with no history for the path resolves null", async () => {
    const git = fake({
      "fetch --quiet origin": { code: 0 },
      "log -1 --format=%H refs/remotes/origin/": { code: 0, stdout: "" },
    });
    const checker = new BranchFileStepsChecker({ run: git.run });
    expect(await checker.read(DIR, FOLDER, TARGET)).toBeNull();
  });
});

// A tick on a spec with an open branch is written to the branch
// (spec-edit.ts, REQ-4), and the disk copy stays unticked until archive
// lands. The row's "archive held back" and the queue's archive hold-back
// read this answer first, so a spec whose every row is ticked on its
// branch is not held for the disk copy's sake (364, 2026-09-03).
describe("the branch's own acceptance rows", () => {
  const withRows = (rows: { task: string; done: boolean }[]) => {
    const answers = branchFile(["create", "analyze", "implement"], ["create", "analyze", "implement"]);
    answers[`show refs/remotes/origin/${TARGET.branch}:${JSON_PATH}`] = {
      code: 0,
      stdout: JSON.stringify({
        completedPhases: ["create", "analyze", "implement"],
        archived: null,
        reopened: null,
        acceptanceCriteria: rows,
        phaseCounts: {},
      }),
    };
    return answers;
  };

  test("an open row on the branch answers acceptanceOpen", async () => {
    const git = fake(withRows([{ task: "REQ-1", done: true }, { task: "REQ-2", done: false }]));
    const steps = await new BranchFileStepsChecker({ run: git.run }).read(DIR, FOLDER, TARGET);
    expect(steps?.acceptanceOpen).toBe(true);
  });

  test("every row ticked on the branch answers not open, whatever disk says", async () => {
    const git = fake(withRows([{ task: "REQ-1", done: true }, { task: "REQ-2", done: true }]));
    const steps = await new BranchFileStepsChecker({ run: git.run }).read(DIR, FOLDER, TARGET);
    expect(steps?.acceptanceOpen).toBe(false);
  });

  test("with no state file on the branch, the prose's own acceptance rows answer", async () => {
    const answers = branchFile(["create", "analyze", "implement"]);
    answers[`show refs/remotes/origin/${TARGET.branch}:${TARGET.relPath}`] = {
      code: 0,
      stdout:
        "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create, analyze, implement\n\n" +
        "## Acceptance criteria\n\n| Task | Status | Notes |\n|------|--------|-------|\n| REQ-1: it works | ⬜ | |\n",
    };
    const git = fake(answers);
    const steps = await new BranchFileStepsChecker({ run: git.run }).read(DIR, FOLDER, TARGET);
    expect(steps?.acceptanceOpen).toBe(true);
  });
});
