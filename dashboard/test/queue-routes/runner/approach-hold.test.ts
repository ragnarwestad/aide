// An implement chained after the analyze that found two or more real
// alternatives waits for the person who asked to choose between them;
// an implement started on its own never does.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchFileStepsChecker } from "../../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { fixedSentenceHolds, type ScheduleContext } from "../../../src/serve/schedules";
import { renderSentence } from "../../../src/i18n/message.ts";
import { cleanupHarness, enqueue, makeRunner, resetHarness, spawns, store } from "../../queue/runner/runner-fixtures.ts";

const FOLDER = "590-choose-the-approach";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const APPROACHES =
  "**Approach A: Hold it (recommended).** a\n\n" +
  "**Approach B: End it (real alternative).** b\n\n" +
  "**Approach C: Hold all (considered and rejected).** c\n";

const solutionText = (approaches: string, chosen?: string): string =>
  "# Spec - Solution\n\n## Approaches\n\n" +
  (chosen ? `**Chosen approach:** Approach ${chosen}\n\n` : "") +
  approaches +
  "\n### Recommended: Approach A\n\nWhy.\n";

/** A projects root with one analyzed spec that asked to choose. */
function projectsRoot(opts: { optedIn?: boolean; solution?: string; analyzed?: boolean } = {}): { root: string; specDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-approach-hold-"));
  dirs.push(dir);
  const root = join(dir, "root");
  const project = join(root, "aide");
  const specDir = join(project, "specs", FOLDER);
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(
    join(specDir, "1-description.md"),
    "# Spec - Description\n\n## Tracking info\n\n- **Created:** `2026-10-03 07:00 UTC`\n" +
      `- **Let me choose the approach:** ${opts.optedIn === false ? "no" : "yes"}\n\n---\n\n## Description\n\nText.\n`,
  );
  writeFileSync(join(specDir, "3-solution.md"), opts.solution ?? solutionText(APPROACHES));
  const phases = opts.analyzed === false ? [] : ["create", "analyze"];
  writeFileSync(
    join(specDir, "4-status.md"),
    `# Spec - Status\n\n## Tracking info\n\n- **Workflow steps completed:** ${phases.join(", ")}\n`,
  );
  writeFileSync(
    join(specDir, "4-status.json"),
    JSON.stringify({ completedPhases: phases, archived: null, reopened: null, acceptanceCriteria: [], phaseCounts: {} }),
  );
  return { root, specDir };
}

const emptyChecker = (): BranchFileStepsChecker => new BranchFileStepsChecker({ run: async () => ({ code: 1, stdout: "" }) });

/** A checker that has read the spec's open branch, whose 3-solution.md is `solution`. */
async function branchChecker(specDir: string, solution: string): Promise<BranchFileStepsChecker> {
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
    if (line.endsWith("4-status.md")) return { code: 0, stdout: "# Status\n\n- **Workflow steps completed:** create, analyze\n" };
    if (line.endsWith("4-status.json")) {
      return { code: 0, stdout: JSON.stringify({ completedPhases: ["create", "analyze"], archived: null, reopened: null, acceptanceCriteria: [], phaseCounts: {} }) };
    }
    if (line.endsWith("3-solution.md")) return { code: 0, stdout: solution };
    return { code: 1, stdout: "" };
  };
  const checker = new BranchFileStepsChecker({ run });
  await checker.read(specDir, FOLDER, target);
  return checker;
}

type QueuedJob = { id: string; project: string; specFolder: string; state: string; steps: string[]; stepIndex: number };
const chained: QueuedJob = { id: "chained", project: "aide", specFolder: FOLDER, state: "queued", steps: ["analyze", "implement"], stepIndex: 1 };
const alone: QueuedJob = { id: "alone", project: "aide", specFolder: FOLDER, state: "queued", steps: ["implement"], stepIndex: 0 };

function ctxFor(root: string, jobs: QueuedJob[], checker: BranchFileStepsChecker = emptyChecker()): ScheduleContext {
  return { projectRoot: root, queue: { list: () => jobs }, readBranchFileSteps: () => checker } as unknown as ScheduleContext;
}

const sentence = (m: unknown): string => renderSentence("en", m as Parameters<typeof renderSentence>[1]) ?? "";

describe("which queued implements wait for a choice", () => {
  test("an implement chained after the analyze waits, with the approach sentence (AC-3)", () => {
    const { root } = projectsRoot();
    const holds = fixedSentenceHolds(ctxFor(root, [chained]));
    expect(holds.get("chained")).toEqual({ key: "runner.approachChoice" });
  });

  test("an implement started on its own is never held for a choice (AC-8)", () => {
    const { root } = projectsRoot();
    expect(fixedSentenceHolds(ctxFor(root, [alone])).has("alone")).toBe(false);
  });

  test("fewer than two real alternatives hold nothing (AC-4)", () => {
    const { root } = projectsRoot({
      solution: solutionText("**Approach A: One (recommended).** a\n\n**Approach B: Two (considered and rejected).** b\n"),
    });
    expect(fixedSentenceHolds(ctxFor(root, [chained])).has("chained")).toBe(false);
  });

  test("a chosen approach written to 3-solution.md releases the hold (AC-5, AC-7)", () => {
    const { root, specDir } = projectsRoot();
    expect(fixedSentenceHolds(ctxFor(root, [chained])).has("chained")).toBe(true);
    writeFileSync(join(specDir, "3-solution.md"), solutionText(APPROACHES, "A"));
    expect(fixedSentenceHolds(ctxFor(root, [chained])).has("chained")).toBe(false);
  });

  test("the branch copy decides when it has been read: a choice saved there releases the hold (AC-5)", async () => {
    const { root, specDir } = projectsRoot();
    const checker = await branchChecker(specDir, solutionText(APPROACHES, "A"));
    expect(fixedSentenceHolds(ctxFor(root, [chained], checker)).has("chained")).toBe(false);
  });

  test("a spec that did not ask to choose holds nothing, whatever its plan says (AC-9)", () => {
    const { root } = projectsRoot({ optedIn: false });
    expect(fixedSentenceHolds(ctxFor(root, [chained])).has("chained")).toBe(false);
  });

  test("an implement whose spec is not analyzed is still held for that", () => {
    const { root } = projectsRoot({ analyzed: false });
    expect(fixedSentenceHolds(ctxFor(root, [alone])).get("alone")).toEqual({ key: "runner.notAnalyzed" });
  });
});

describe("the runner holds what the map names", () => {
  beforeEach(resetHarness);
  afterEach(cleanupHarness);

  test("a held chained implement stays queued with the approach sentence and is not started (AC-3)", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    store.update(job.id, { stepIndex: 1 });
    makeRunner().tick(undefined, new Map([[job.id, { key: "runner.approachChoice" }]]));
    expect(spawns).toHaveLength(0);
    expect(store.get(job.id)?.state).toBe("queued");
    expect(sentence(store.get(job.id)?.error)).toContain("choose the approach");
  });

  test("it starts at the next tick once the map no longer names it (AC-5)", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    store.update(job.id, { stepIndex: 1 });
    const runner = makeRunner();
    runner.tick(undefined, new Map([[job.id, { key: "runner.approachChoice" }]]));
    runner.tick(undefined, new Map());
    expect(spawns).toHaveLength(1);
    expect(store.get(job.id)?.error).toBeUndefined();
  });
});
