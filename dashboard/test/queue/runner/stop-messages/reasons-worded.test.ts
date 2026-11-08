// The runner's other endings are worded by the board, in the reader's
// language, with the result's `errorLog` behind the (?): a step that
// reached past its scope, a short analysis over its limits, a spec sent back
// to a full analysis or refused that, and a create that made no folder.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "../runner-fixtures.ts";
import { cliErrorMessage, noProgressMessage, runStopMessage } from "../../../../src/queue/runner/cross-check-message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const ended = (terminalReason: string, more: Record<string, unknown> = {}) => ({ ok: false, terminalReason, error: "the runner's own words", ...more });

describe("noProgressMessage", () => {
  test("a scope violation says which check it tripped and names its files (AC-4)", () => {
    expect(noProgressMessage("implement", ended("scope-violation", { scopeViolation: "specs" }))).toMatchObject({ key: "runner.scopeSpecs" });
    expect(noProgressMessage("implement", ended("scope-violation", { scopeViolation: "specs", scopeSpecs: ["00-x/5-note.md", "01-y/a.md"] }))).toEqual({
      key: "runner.scopeSpecsNamed",
      values: { button: "Implement", paths: "00-x/5-note.md, 01-y/a.md" },
    });
    expect(noProgressMessage("analyze", ended("scope-violation", {
      scopeViolation: "analyze",
      scopeAnalyze: { project: { committed: ["src/a.ts"], uncommitted: ["src/b.ts"] }, phaseRows: true, workflowSteps: true },
    }))).toEqual({
      key: "runner.scopeAnalyze",
      values: { button: "Analyze", checks: "project code (committed: src/a.ts; uncommitted: src/b.ts); Phase-table rows; Workflow steps completed" },
    });
    expect(noProgressMessage("analyze", ended("scope-violation", { scopeViolation: "analyze" }))).toEqual({
      key: "runner.scopeAnalyzeLegacy",
      values: { button: "Analyze" },
    });
    expect(noProgressMessage("analyze", ended("scope-violation"))).toBeUndefined();
  });

  test("a short analysis over its limits, and a send-back that was refused", () => {
    expect(noProgressMessage("analyze", ended("short-analysis-over-limit"))).toMatchObject({ key: "runner.shortAnalysisOverLimit" });
    expect(noProgressMessage("implement", ended("sent-back-refused"))).toEqual({
      key: "runner.sentBackRefused",
      values: { button: "Implement", analyze: "Analyze" },
    });
  });

  test("a create that left no folder", () => {
    expect(noProgressMessage("create", ended("no-progress"))).toMatchObject({ key: "runner.noProgressCreate" });
  });
});

describe("cliErrorMessage", () => {
  test("a scheduled job that failed names Run now as the button to press again", () => {
    expect(cliErrorMessage("schedule", ended("cli-error", { tool: "claude", providerError: { kind: "silent" } }))).toEqual({
      key: "runner.cliErrorSilent",
      values: { tool: "Claude Code", button: "Run now" },
    });
  });
});

describe("runStopMessage", () => {
  test("a spec sent back to a full analysis names the step that runs next", () => {
    expect(runStopMessage("implement", ended("sent-back"))).toEqual({ key: "runner.sentBack", values: { button: "Implement", analyze: "Analyze" } });
  });
});

describe("the detail behind a sentence the board words", () => {
  const stored = (outcome: Record<string, unknown>, step = "implement") => {
    const job = enqueue({ steps: [step] });
    const runner = makeRunner({ readResult: () => ({ ...okResult(0.1), ...outcome }) });
    runner.tick();
    runner.poll();
    return store.get(job.id);
  };
  const result = (terminalReason: string, more: Record<string, unknown> = {}) => ({ ok: false, terminalReason, ...more });

  test("a sent-back stop keeps the result's errorLog whole (AC-2)", () => {
    const after = stored(result("sent-back", { errorLog: "the plan misses the migration\nand the rollback" }));
    expect(after?.error).toMatchObject({ key: "runner.sentBack" });
    expect(after?.errorDetail).toBe("the plan misses the migration\nand the rollback");
  });

  test("a criteria stop keeps the plan review's faults as the errorLog (AC-2)", () => {
    const after = stored(
      result("acceptance-criteria", {
        criteriaFaults: { missing: false, notEars: ["AC-1"], noScenario: [], contradictions: [], cannotBuild: [] },
        errorLog: "AC-1 is vague",
      }),
      "analyze",
    );
    expect(after?.error).toMatchObject({ key: "runner.criteriaStopped" });
    expect(after?.errorDetail).toBe("AC-1 is vague");
  });

  test("a failure keeps the errorLog by the same rule, with no line cut (AC-2, AC-3)", () => {
    const log = "a.test.ts › works\nb.test.ts › stays";
    expect(stored(result("tests-red", { errorLog: log }))?.errorDetail).toBe(log);
    expect(stored(result("tests-not-started", { errorLog: log }))?.errorDetail).toBe(log);
  });

  test("a stop that carries no errorLog leaves no detail (AC-2)", () => {
    expect(stored(result("timeout", { timeLimit: { seconds: 10, during: "session" } }))?.errorDetail).toBeUndefined();
    expect(stored(result("scope-violation", { scopeViolation: "specs", scopeSpecs: ["00-x/5-note.md"] }))?.errorDetail).toBeUndefined();
  });
});

describe("a stop in the runner's own words", () => {
  test("stores the problem and the fix apart (AC-4)", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0.1), ...ended("timeout", { error: "ran out of time", errorSolution: "press Implement again" }) }),
    });
    runner.tick();
    runner.poll();
    const stored = store.get(job.id);
    expect(stored?.state).toBe("stopped");
    expect(stored?.error).toMatchObject({ key: "message.written", values: { problem: "ran out of time", solution: "press Implement again" } });
  });

  test("an outcome without a fix stores the plain string (AC-5)", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner({ readResult: () => ({ ...okResult(0.1), ...ended("timeout", { error: "ran out of time" }) }) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.error).toBe("ran out of time");
  });
});
