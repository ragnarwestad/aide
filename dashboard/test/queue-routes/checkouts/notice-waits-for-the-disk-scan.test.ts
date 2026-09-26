// The files-disagree notice compares 4-status.md (the disk scan) with the
// committed history. `sourcesCheckedAt` used to be the history's read
// time alone, so a scan taken before a step ended, next to a history
// read after its commit, showed the notice about a phase that ran fine.
// The scan's own read time now counts, so the row waits for a scan taken
// after the step.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSpecsRows, type SpecTarget } from "../../../src/render";
import { withFreshness, type LandContext } from "../../../src/serve/land-branch";
import { targets, type ScanState, type SpecLookupContext } from "../../../src/serve/spec-lookup.ts";
import { openKeys, row } from "../../render/pages/fixtures.ts";

const FOLDER = "480-transition";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A projects root whose one spec's 4-status.md names create and analyze
 *  and has NO 4-status.json: with a state file the comparison would be
 *  prose against the state file, not against git. */
function projectsRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-notice-disk-scan-"));
  dirs.push(dir);
  const root = join(dir, "root");
  const project = join(root, "aide");
  const specDir = join(project, "specs", FOLDER);
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "1-description.md"), "# Transition - Description\n");
  writeFileSync(
    join(specDir, "4-status.md"),
    "# Transition - Status\n\n## Tracking info\n\n- **Workflow steps completed:** create, analyze\n",
  );
  return root;
}

/** The real disk scan, and the moment it stored. */
function scan(root: string): { at: number; list: SpecTarget[] } {
  let stored: ScanState | null = null;
  const ctx = {
    projectRoot: root,
    allowed: new Set(["aide"]),
    ownedSpecsRoot: () => undefined,
    readScan: () => stored,
    writeScan: (s: ScanState | null) => {
      stored = s;
    },
    branchStatus: { peekOpenSpecBranches: () => ({ open: null }) },
    readBranchFileSteps: () => undefined,
  } as unknown as SpecLookupContext;
  const list = targets(ctx);
  return { at: (stored as ScanState | null)!.at, list };
}

/** A history that has seen implement's commit, read `historyAt`. */
const landCtx = (historyAt: number): LandContext =>
  ({
    workflowHistory: {
      peekHistory: () => ({
        history: { done: ["create", "analyze", "implement"], stopped: {} },
        checkedAt: historyAt,
      }),
    },
    specCreatedAt: { peekCreatedAt: () => ({ createdAt: null, checkedAt: 1 }) },
    freshness: { peekStale: () => ({ stale: false }) },
    branchFileSteps: { peekFileSteps: () => ({ steps: null, checkedAt: null }) },
  }) as unknown as LandContext;

describe("the files-disagree notice waits for the disk scan", () => {
  test("sourcesCheckedAt is no later than the scan that supplied the files (AC-1)", () => {
    const { at, list } = scan(projectsRoot());
    const resolved = withFreshness(landCtx(at + 2000), list)[0]!;
    expect(Date.parse(resolved.sourcesCheckedAt!)).toBeLessThanOrEqual(at);
  });

  const page = (read: { at: number; list: SpecTarget[] }, endedAt: number): string => {
    const { at, list } = read;
    const resolved = withFreshness(landCtx(at + 2000), list);
    const implemented = row({
      id: "impl",
      specFolder: FOLDER,
      steps: ["implement"],
      stepIndex: 0,
      state: "done",
      results: [
        { step: "implement", ok: true, costUsd: 1, terminalReason: "completed", at: new Date(endedAt).toISOString() },
      ],
    });
    return renderSpecsRows(
      [implemented],
      { runnerAvailable: true, targets: resolved, filter: { open: openKeys([implemented], resolved) } },
      at + 5000,
    );
  };

  test("a step that ended after the scan is not called a disagreement, history fresh or not (AC-2)", () => {
    const read = scan(projectsRoot());
    expect(page(read, read.at + 1000)).not.toContain("disagree about whether");
  });

  test("a step that ended before the scan, with files still short of it, is said (AC-2)", () => {
    const read = scan(projectsRoot());
    expect(page(read, read.at - 1000)).toContain("disagree about whether");
  });
});
