// A spec's facts carry two details read from files only when asked for.
// Adding history or an earlier round to the facts must carry them over
// without asking.

import { describe, expect, test } from "bun:test";
import { withSpecFacts, type SpecTarget } from "../../src/project/spec-facts.ts";

function countingFacts(): { facts: SpecTarget; calls: { acceptance: number; approach: number } } {
  const calls = { acceptance: 0, approach: 0 };
  const facts: SpecTarget = {
    project: "aide",
    specFolder: "01-one",
    done: ["create"],
    readAcceptance: () => { calls.acceptance++; return []; },
    readApproachChoice: () => { calls.approach++; return undefined; },
  };
  return { facts, calls };
}

describe("withSpecFacts", () => {
  test("adding history reads neither detail and carries both read functions over (AC-2)", () => {
    const { facts, calls } = countingFacts();
    const added = withSpecFacts(facts, { done: ["create", "analyze"], historyDone: ["analyze"] });
    expect(calls).toEqual({ acceptance: 0, approach: 0 });
    expect(added.readAcceptance).toBe(facts.readAcceptance);
    expect(added.readApproachChoice).toBe(facts.readApproachChoice);
    expect(added.done).toEqual(["create", "analyze"]);
    expect(added.historyDone).toEqual(["analyze"]);
    expect(facts.done).toEqual(["create"]);
  });

  test("adding a round's start reads neither detail (AC-2)", () => {
    const { facts, calls } = countingFacts();
    const round = withSpecFacts(facts, { createdAt: "2026-11-01T10:00:00Z" });
    expect(calls).toEqual({ acceptance: 0, approach: 0 });
    expect(round.createdAt).toBe("2026-11-01T10:00:00Z");
    expect(round.specFolder).toBe("01-one");
  });
});
