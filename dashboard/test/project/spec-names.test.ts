import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AC_COVERAGE_FILE, ANALYSIS_FILE, DESCRIPTION_FILE, SOLUTION_FILE, STATE_FILE, STATUS_FILE,
  isProvisionalKey, isScheduleKey, isSpecFolder, newProvisionalKey, scheduleNameOf, scheduleTrackingKey,
  groupBranch, isGroupBranch, specBranch, specFolderOfBranch,
} from "../../src/project/spec-names.ts";

const LIB = join(import.meta.dir, "..", "..", "..", "core", "scripts", "lib", "spec-reference.sh");
const CONTRACT = join(import.meta.dir, "..", "..", "..", "core", "scripts", "lib", "spec-identity.json");

const EXPECTED_CONTRACT = {
  specFolderPattern: "^[0-9]+-",
  branchPrefix: "aide/",
  groupBranchPrefix: "aide/group-",
  provisionalKeyPattern: "^new-[0-9a-f]{8}$",
  provisionalKeyPrefix: "new-",
  provisionalKeyHexLength: 8,
  scheduleKeyPrefix: "schedule-",
  descriptionFile: "1-description.md",
  analysisFile: "2-analysis.md",
  solutionFile: "3-solution.md",
  statusFile: "4-status.md",
  stateFile: "4-status.json",
  acCoverageFile: "ac-coverage.json",
};

/** One bash function's answer: its exit status, and what it printed. */
const bash = (script: string, ...args: string[]): { ok: boolean; out: string } => {
  const run = Bun.spawnSync({ cmd: ["bash", "-c", `set -u; source "$1"; shift; ${script}`, "_", LIB, ...args], stdout: "pipe" });
  return { ok: run.exitCode === 0, out: run.stdout.toString() };
};

test("the shared contract owns every static spec identity value (AC-1)", () => {
  expect(existsSync(CONTRACT)).toBe(true);
  if (!existsSync(CONTRACT)) return;
  expect(JSON.parse(readFileSync(CONTRACT, "utf8"))).toEqual(EXPECTED_CONTRACT);
});

describe("the spec-folder test", () => {
  const SPEC = ["742-x", "05-x"];
  const NOT = ["42", "42x", "x-42", "new-0a1b2c3d", "schedule-nightly", "main", ""];

  for (const name of [...SPEC, ...NOT]) {
    const want = SPEC.includes(name);
    test(`${JSON.stringify(name)} is ${want ? "" : "not "}a spec folder on both sides (AC-3)`, () => {
      expect(isSpecFolder(name)).toBe(want);
      expect(bash('aide_is_spec_folder "$1"', name).ok).toBe(want);
    });
  }
});

describe("a spec's branch", () => {
  test("is built and read back alike on both sides (AC-4, AC-5)", () => {
    expect(specBranch("742-x")).toBe("aide/742-x");
    expect(specFolderOfBranch(specBranch("742-x"))).toBe("742-x");
    expect(bash('aide_spec_branch "$1"', "742-x").out).toBe(specBranch("742-x"));
  });

  test("a group uses its immutable first member on both sides (AC-4, AC-5)", () => {
    expect(groupBranch("742-first")).toBe("aide/group-742-first");
    expect(groupBranch("742-first", "Release / unsafe name")).toBe("aide/group-742-first");
    expect(bash('aide_group_branch "$1"', "742-first").out).toBe(groupBranch("742-first"));
  });

  test.each([
    [groupBranch("742-first"), true],
    ["aide/group-", false],
    ["aide/742-x", false],
    ["main", false],
    ["refs/heads/aide/group-1", false],
    ["", false],
  ])("%p is a group's branch on both sides: %p", (branch, want) => {
    expect(isGroupBranch(branch)).toBe(want);
    expect(bash('aide_is_group_branch "$1"', branch).ok).toBe(want);
  });

  test.each(["main", "aide/", "refs/heads/aide/742-x", ""])("%p names no spec (AC-3)", (branch) => {
    expect(specFolderOfBranch(branch)).toBeUndefined();
  });
});

describe("the provisional create key", () => {
  test("one the dashboard makes is recognised on both sides (AC-3, AC-5)", () => {
    const key = newProvisionalKey();
    expect(isProvisionalKey(key)).toBe(true);
    expect(bash('aide_is_provisional_key "$1"', key).ok).toBe(true);
  });

  test.each(["new-0A1B2C3D", "new-0a1b2c3", "new-0a1b2c3d4", "742-new-0a1b2c3d", "742-x"])(
    "%p is not one on either side (AC-3, AC-5)",
    (key) => {
      expect(isProvisionalKey(key)).toBe(false);
      expect(bash('aide_is_provisional_key "$1"', key).ok).toBe(false);
    },
  );
});

describe("the schedule key", () => {
  test("is made from an entry's name and read back to it on both sides (AC-4, AC-5)", () => {
    const key = scheduleTrackingKey("nightly-report");
    expect(key).toBe("schedule-nightly-report");
    expect(isScheduleKey(key)).toBe(true);
    expect(scheduleNameOf(key)).toBe("nightly-report");
    expect(bash('aide_schedule_name "$1"', key).out).toBe("nightly-report");
  });

  test("any other key is not one, and both sides give it back whole (AC-3, AC-5)", () => {
    expect(isScheduleKey("742-x")).toBe(false);
    expect(scheduleNameOf("742-x")).toBe("742-x");
    expect(bash('aide_schedule_name "$1"', "742-x").out).toBe("742-x");
  });
});

describe("the spec's file names", () => {
  const PAIRS: Array<[string, string]> = [
    ["AIDE_DESCRIPTION_FILE", DESCRIPTION_FILE],
    ["AIDE_ANALYSIS_FILE", ANALYSIS_FILE],
    ["AIDE_SOLUTION_FILE", SOLUTION_FILE],
    ["AIDE_STATUS_FILE", STATUS_FILE],
    ["AIDE_STATE_FILE", STATE_FILE],
    ["AIDE_AC_COVERAGE_FILE", AC_COVERAGE_FILE],
  ];

  test("are the same six names on both sides (AC-5, AC-6)", () => {
    const names = bash(PAIRS.map(([variable]) => `printf '%s\\n' "$${variable}"`).join("; ")).out.split("\n").slice(0, -1);
    expect(names).toEqual(PAIRS.map(([, name]) => name));
    expect(new Set(names).size).toBe(PAIRS.length);
  });
});
