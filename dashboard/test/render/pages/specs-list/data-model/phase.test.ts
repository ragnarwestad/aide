import { describe, expect, test } from "bun:test";
import { nextPhase, phasesAhead, runButton } from "../../../../../src/render/pages/specs-list/data-model/phase.ts";

describe("the Run button's label and enabled state, from the phases done and ticked", () => {
  test("nothing ticked names the next phase, disabled (AC-1)", () => {
    expect(runButton(["create", "analyze"], new Set())).toEqual({ label: "Implement", active: false });
  });

  test("a ticked phase that has already run is named and enabled (AC-2)", () => {
    expect(runButton(["create", "analyze"], new Set(["analyze"]))).toEqual({ label: "Analyze", active: true });
    expect(runButton(["create", "analyze"], new Set(["analyze", "archive"]))).toEqual({ label: "Analyze", active: true });
  });
});

describe("the phases a spec on the list still has ahead of it", () => {
  test("archive is never counted done, and the next phase is the first ahead (AC-3)", () => {
    const cases: [string[], string[]][] = [
      [[], ["analyze", "implement", "archive"]],
      [["create"], ["analyze", "implement", "archive"]],
      [["create", "analyze"], ["implement", "archive"]],
      [["create", "analyze", "implement"], ["archive"]],
      [["create", "analyze", "implement", "archive"], ["archive"]],
      [["archive"], ["analyze", "implement", "archive"]],
    ];
    for (const [done, ahead] of cases) {
      expect(phasesAhead(done)).toEqual(ahead);
      expect(nextPhase(done)).toBe(ahead[0]);
    }
  });
});
