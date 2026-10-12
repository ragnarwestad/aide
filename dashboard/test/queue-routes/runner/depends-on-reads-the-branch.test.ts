// A Depends on saved on a spec with an open `aide/<folder>` branch is
// written onto that branch (the tracking route's write target), and the
// checkout's copy stays as it was until archive lands. The row's own line
// reads the branch copy first, like the acceptance rows and the approach
// choice. The queue's hold waits for what EITHER copy names: the runner
// script's own gate reads the checkout, so a dependency the branch has
// dropped still holds the job.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchFileStepsChecker } from "../../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { blockedDependencies } from "../../../src/serve/schedules/blocked.ts";
import { targets, type SpecLookupContext } from "../../../src/serve/spec-lookup.ts";

const FOLDER = "81-dependent";
const NEW_DEPENDENCY = "99-a-second-spec";
const OLD_DEPENDENCY = "80-dependency";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const described = (dependsOn: string[]) =>
  "# Dependent - Description\n\n## Tracking info\n\n- **Created:** `2026-10-12`\n" +
  (dependsOn.length ? `- **Depends on:** ${dependsOn.map((d) => `\`${d}\``).join(", ")}\n` : "");

/** A projects root whose checkout copy of the spec names `onDisk`. */
function projectsRoot(onDisk: string[]): { root: string; specs: string; specDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-depends-branch-"));
  dirs.push(dir);
  const root = join(dir, "root");
  const specs = join(root, "aide", "specs");
  mkdirSync(join(root, "aide", ".aide"), { recursive: true });
  writeFileSync(join(root, "aide", ".aide", "project.yaml"), "name: aide\n");
  for (const folder of [OLD_DEPENDENCY, NEW_DEPENDENCY]) {
    mkdirSync(join(specs, folder), { recursive: true });
    writeFileSync(join(specs, folder, "1-description.md"), `# ${folder}\n`);
  }
  const specDir = join(specs, FOLDER);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "1-description.md"), described(onDisk));
  return { root, specs, specDir };
}

/** A checker that has read the branch, whose description names `onBranch`. */
async function warmedChecker(specDir: string, onBranch: string[]): Promise<BranchFileStepsChecker> {
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
    if (line.endsWith("1-description.md")) return { code: 0, stdout: described(onBranch) };
    if (line.endsWith("4-status.md")) return { code: 0, stdout: "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n" };
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

const dependsOnOf = (root: string, checker: BranchFileStepsChecker | undefined) =>
  targets(lookupCtx(root, checker)).find((t) => t.specFolder === FOLDER)?.dependsOn;

describe("the row's own Depends on line", () => {
  test("is the branch's when the branch has an answer, though the checkout names none (AC-3)", async () => {
    const { root, specDir } = projectsRoot([]);
    expect(dependsOnOf(root, await warmedChecker(specDir, [NEW_DEPENDENCY]))).toEqual([NEW_DEPENDENCY]);
  });

  test("is empty when the branch has dropped the line the checkout still names (AC-3)", async () => {
    const { root, specDir } = projectsRoot([OLD_DEPENDENCY]);
    expect(dependsOnOf(root, await warmedChecker(specDir, []))).toEqual([]);
  });

  test("is the checkout's when there is no branch answer (AC-3)", () => {
    const { root } = projectsRoot([OLD_DEPENDENCY]);
    expect(dependsOnOf(root, undefined)).toEqual([OLD_DEPENDENCY]);
  });

  // The Running tab's picker ticks by folder, and a hand-written line is
  // often a bare number.
  test("names a bare number by the folder it resolves to, and keeps an entry nothing matches as written (AC-1)", () => {
    const { root } = projectsRoot(["99", "77"]);
    expect(dependsOnOf(root, undefined)).toEqual([NEW_DEPENDENCY, "77"]);
  });
});

describe("the queue's dependency hold", () => {
  const queued = { id: "job-1", state: "queued", project: "aide", specFolder: FOLDER, steps: ["archive"], stepIndex: 0 };

  function holdCtx(root: string, specs: string, specDir: string, checker: BranchFileStepsChecker) {
    const lookup = lookupCtx(root, checker);
    return {
      projectRoot: root,
      queue: { list: () => [queued] },
      targets: () => targets(lookup),
      readScan: () => ({ archived: [], dirs: new Map([[`aide/${FOLDER}`, specDir]]) }),
      readBranchFileSteps: () => checker,
      specRoots: () => [specs],
      // Nothing is archived on origin.
      branchStatus: { archivedOnOrigin: async () => false },
    } as unknown as Parameters<typeof blockedDependencies>[0];
  }

  test("waits for the dependency the branch names, though the checkout names none (AC-3)", async () => {
    const { root, specs, specDir } = projectsRoot([]);
    const checker = await warmedChecker(specDir, [NEW_DEPENDENCY]);
    expect((await blockedDependencies(holdCtx(root, specs, specDir, checker))).get("job-1")).toBe(NEW_DEPENDENCY);
  });

  test("still waits for the dependency the checkout names, though the branch has dropped the line (AC-3)", async () => {
    const { root, specs, specDir } = projectsRoot([OLD_DEPENDENCY]);
    const checker = await warmedChecker(specDir, []);
    expect((await blockedDependencies(holdCtx(root, specs, specDir, checker))).get("job-1")).toBe(OLD_DEPENDENCY);
  });
});
