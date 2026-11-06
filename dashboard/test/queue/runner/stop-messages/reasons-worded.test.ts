// The runner's other endings are worded by the board, in the reader's
// language, with the runner's own English kept behind the (?): a step that
// reached past its scope, a short analysis over its limits, a spec sent back
// to a full analysis or refused that, and a create that made no folder.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "../runner-fixtures.ts";
import { noProgressMessage, runStopMessage, withoutRestatedError } from "../../../../src/queue/runner/cross-check-message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const ended = (terminalReason: string, more: Record<string, unknown> = {}) => ({ ok: false, terminalReason, error: "the runner's own words", ...more });

describe("noProgressMessage", () => {
  test("a scope violation says which check it tripped and names its files (AC-4)", () => {
    expect(noProgressMessage("implement", ended("scope-violation", { scopeViolation: "specs" }))).toMatchObject({ key: "runner.scopeSpecs" });
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

  test("a create that left no folder, keeping where the runner looked as the detail", () => {
    expect(noProgressMessage("create", ended("no-progress"))).toMatchObject({ key: "runner.noProgressCreate" });
    expect(withoutRestatedError(ended("no-progress"), "create").error).toBe("the runner's own words");
    expect(withoutRestatedError(ended("no-progress"), "implement").error).toBeUndefined();
  });
});

describe("runStopMessage", () => {
  test("a spec sent back to a full analysis names the step that runs next", () => {
    expect(runStopMessage("implement", ended("sent-back"))).toEqual({ key: "runner.sentBack", values: { button: "Implement", analyze: "Analyze" } });
  });
});

describe("a stop the board words", () => {
  test("keeps the runner's own sentence as the detail", () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner({ readResult: () => ({ ...okResult(0.1), ...ended("sent-back", { error: "the plan misses the migration" }) }) });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.error).toMatchObject({ key: "runner.sentBack" });
    expect(store.get(job.id)?.errorDetail).toBe("the plan misses the migration");
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
