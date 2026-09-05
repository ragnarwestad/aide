// Spec 356: dashboard/src/queue/spec-transitions.ts — the read-only use
// of core/scripts/lib/transitions.json that decides whether a request
// may move a spec between phases (REQ-9's enqueue-time check).

import { describe, expect, test } from "bun:test";
import { isLegalMove, phaseFromState } from "../../../src/queue/spec-transitions.ts";

describe("phaseFromState", () => {
  test("created: no completed phases", () => {
    expect(phaseFromState([], null)).toBe("created");
  });
  test("analyzed: analyze in completedPhases", () => {
    expect(phaseFromState(["create", "analyze"], null)).toBe("analyzed");
  });
  test("implemented: implement in completedPhases", () => {
    expect(phaseFromState(["create", "analyze", "implement"], null)).toBe("implemented");
  });
  test("archived: the archived stamp wins even before completedPhases gains archive", () => {
    expect(phaseFromState(["create", "analyze", "implement"], { date: "2026-09-01" })).toBe("archived");
  });
  test("closed: the closed stamp wins over archived and completedPhases both", () => {
    expect(
      phaseFromState(["create", "analyze", "implement"], { date: "2026-09-01" }, { date: "2026-09-05" }),
    ).toBe("closed");
  });
  test("omitting closed keeps every pre-406 caller reading the same phase as before", () => {
    expect(phaseFromState(["create"], null)).toBe("created");
  });
});

describe("isLegalMove", () => {
  test("analyze is legal from created", () => {
    const move = isLegalMove("created", "analyze", "7-x");
    expect(move.ok).toBe(true);
  });

  test("implement is refused before analyze, with the gate's own words", () => {
    const move = isLegalMove("created", "implement", "7-x");
    expect(move.ok).toBe(false);
    if (!move.ok) {
      expect(move.reason).toBe("not-analyzed-yet");
      expect(move.message).toBe("spec 7-x has not been analyzed yet — run /aide-analyze first");
    }
  });

  // REQ-9: the spec-342 bug — analyze/create requested on a spec already
  // past that phase must be refused, naming reset as the way back.
  test("analyze is refused once a spec has implemented, naming reset", () => {
    const move = isLegalMove("implemented", "analyze", "342-x");
    expect(move.ok).toBe(false);
    if (!move.ok) {
      expect(move.reason).toBe("already-implemented");
      expect(move.message).toContain("/aide-reset");
    }
  });

  test("create is refused once a spec has analyzed, naming reset", () => {
    const move = isLegalMove("analyzed", "create", "342-x");
    expect(move.ok).toBe(false);
    if (!move.ok) {
      expect(move.message).toContain("/aide-reset");
    }
  });

  test("the same-phase re-run is still legal, not treated as backward", () => {
    const move = isLegalMove("analyzed", "analyze", "7-x");
    expect(move.ok).toBe(true);
  });

  test("every step but reopen is refused on an archived spec", () => {
    for (const event of ["create", "analyze", "implement", "archive"]) {
      const move = isLegalMove("archived", event, "7-x");
      expect(move.ok).toBe(false);
      if (!move.ok) expect(move.message).toContain("only reopen");
    }
    expect(isLegalMove("archived", "reopen", "7-x").ok).toBe(true);
  });

  test("an unlisted [phase, event] pair is refused, never silently accepted", () => {
    const move = isLegalMove("created", "bogus-event", "7-x");
    expect(move.ok).toBe(false);
  });

  // spec 406, REQ-1/REQ-13: close is legal from every pre-archive phase,
  // unlike archive — it carries no not-implemented-yet gate.
  test("close is legal from created, analyzed and implemented", () => {
    for (const phase of ["created", "analyzed", "implemented"] as const) {
      expect(isLegalMove(phase, "close", "7-x").ok).toBe(true);
    }
  });

  test("close is refused on an archived spec, naming reopen", () => {
    const move = isLegalMove("archived", "close", "7-x");
    expect(move.ok).toBe(false);
    if (!move.ok) expect(move.message).toContain("only reopen");
  });

  test("every step but reopen is refused on a closed spec", () => {
    for (const event of ["create", "analyze", "implement", "archive", "close"]) {
      const move = isLegalMove("closed", event, "7-x");
      expect(move.ok).toBe(false);
      if (!move.ok) {
        expect(move.reason).toBe("already-closed");
        expect(move.message).toContain("only reopen");
      }
    }
    expect(isLegalMove("closed", "reopen", "7-x").ok).toBe(true);
  });
});
