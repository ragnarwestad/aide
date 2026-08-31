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

/** What `readStatusFromBranch` needs answered, for a branch whose
 *  `4-status.md` names `steps`. */
const branchFile = (steps: string[]) => ({
  "fetch --quiet origin": { code: 0 },
  "log -1 --format=%H refs/remotes/origin/": { code: 0, stdout: "deadbeef1234\n" },
  "show refs/remotes/origin/": {
    code: 0,
    stdout: `# Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${steps.join(", ")}\n`,
  },
});

describe("BranchFileStepsChecker", () => {
  test("an open branch whose file names steps resolves those steps", async () => {
    const git = fake(branchFile(["create", "analyze", "implement"]));
    const checker = new BranchFileStepsChecker({ run: git.run });
    const steps = await checker.read(DIR, FOLDER, TARGET);
    expect(steps).toEqual(["create", "analyze", "implement"]);
  });

  test("peekFileSteps hands back the read answer, spawning no git", async () => {
    const git = fake(branchFile(["analyze"]));
    const checker = new BranchFileStepsChecker({ run: git.run, now: () => 1000 });
    await checker.read(DIR, FOLDER, TARGET);
    const before = git.calls.length;
    const { steps, checkedAt } = checker.peekFileSteps(DIR, FOLDER);
    expect(steps).toEqual(["analyze"]);
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
