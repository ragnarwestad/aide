// The Tests line under Implement counts what the newest implement attempt's
// own commits added and removed, and is not there when it touched no test.

import { describe, expect, test } from "bun:test";
import { phasesFor, type QueueRowView, type StepResultView } from "../../../../../src/render";
import { testTotalsOf } from "../../../../../src/render/pages/specs-list/phase-messages/tests-line.ts";
import { row } from "../../fixtures.ts";

const FOLDER = "501-tests-line";

const job = (id: string, startedAt: string, results: Partial<StepResultView>[]): QueueRowView =>
  row({
    id, specFolder: FOLDER, steps: ["implement"], stepIndex: 0, state: "done", startedAt,
    results: results.map((r) => ({ step: "implement", ok: true, costUsd: 0.1, ...r })),
  });

const implementPhase = (jobs: QueueRowView[]) => phasesFor(jobs, undefined).find((p) => p.step === "implement")!;

describe("the tests an implement brought", () => {
  test("summed over its folders, with the folders kept", () => {
    const dirs = [{ dir: "web/test", added: 9, removed: 2 }, { dir: "py/tests", added: 3, removed: 0 }];
    expect(testTotalsOf(implementPhase([job("a", "2026-11-27T10:00:00Z", [{ testChanges: dirs }])]))).toEqual({ added: 12, removed: 2, dirs });
  });

  test("from the newest attempt, not an older one", () => {
    const older = job("old", "2026-11-26T10:00:00Z", [{ testChanges: [{ dir: "web/test", added: 5, removed: 0 }] }]);
    const newer = job("new", "2026-11-27T10:00:00Z", [{ testChanges: [{ dir: "web/test", added: 1, removed: 1 }] }]);
    expect(testTotalsOf(implementPhase([older, newer]))).toMatchObject({ added: 1, removed: 1 });
  });

  test("nothing when the implement touched no test", () => {
    expect(testTotalsOf(implementPhase([job("a", "2026-11-27T10:00:00Z", [{}])]))).toBeUndefined();
  });
});
