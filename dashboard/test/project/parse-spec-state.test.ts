// spec 355: readSpecState is the one reader of 4-status.json — this
// pins its shape and its "missing means null, never a fallback parse"
// contract (REQ-3, REQ-10).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentAcceptancePhase, currentPhase, readSpecState, type SpecState } from "../../src/project/parse-spec-state.ts";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "parse-spec-state-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readSpecState", () => {
  test("null when there is no 4-status.json at all (REQ-10)", () => {
    expect(readSpecState(join(dir, "does-not-exist"))).toBeNull();
  });

  test("null on invalid JSON, never a throw", () => {
    const d = mkdtempSync(join(tmpdir(), "parse-spec-state-bad-"));
    writeFileSync(join(d, "4-status.json"), "{not json");
    expect(readSpecState(d)).toBeNull();
    rmSync(d, { recursive: true, force: true });
  });

  test("reads every field back verbatim", () => {
    const d = mkdtempSync(join(tmpdir(), "parse-spec-state-full-"));
    const state = {
      completedPhases: ["create", "analyze", "implement"],
      archived: { date: "2026-08-20" },
      reopened: { date: "2026-08-23", boundaryCommit: "1d0fe79" },
      acceptanceCriteria: [{ task: "REQ-1: x", done: true }],
      phaseCounts: { "Phase 1: RED": { done: 1, total: 2 } },
    };
    writeFileSync(join(d, "4-status.json"), JSON.stringify(state));
    expect(readSpecState(d)).toEqual(state);
    rmSync(d, { recursive: true, force: true });
  });

  test("archived and reopened are null, not undefined, when absent", () => {
    const d = mkdtempSync(join(tmpdir(), "parse-spec-state-nulls-"));
    writeFileSync(
      join(d, "4-status.json"),
      JSON.stringify({
        completedPhases: [],
        archived: null,
        reopened: null,
        acceptanceCriteria: [],
        phaseCounts: {},
      }),
    );
    const state = readSpecState(d);
    expect(state?.archived).toBeNull();
    expect(state?.reopened).toBeNull();
    rmSync(d, { recursive: true, force: true });
  });

  test("missing array/object fields default to empty rather than throwing", () => {
    const d = mkdtempSync(join(tmpdir(), "parse-spec-state-partial-"));
    writeFileSync(join(d, "4-status.json"), JSON.stringify({}));
    const state = readSpecState(d);
    expect(state).toEqual({
      completedPhases: [],
      archived: null,
      reopened: null,
      acceptanceCriteria: [],
      phaseCounts: {},
    });
    rmSync(d, { recursive: true, force: true });
  });
});

const emptyState = (): SpecState => ({
  completedPhases: [],
  archived: null,
  reopened: null,
  acceptanceCriteria: [],
  phaseCounts: {},
});

describe("currentPhase", () => {
  test("null with no Phase section at all", () => {
    expect(currentPhase(emptyState())).toBeNull();
  });

  test("the first section with an unfinished row", () => {
    const state = emptyState();
    state.phaseCounts = {
      "Phase 1: RED": { done: 2, total: 2 },
      "Phase 2: GREEN": { done: 1, total: 3 },
      "Phase 3: REFACTOR": { done: 0, total: 1 },
    };
    expect(currentPhase(state)).toBe("Phase 2: GREEN");
  });

  test('"done" once every phase section is finished', () => {
    const state = emptyState();
    state.phaseCounts = { "Phase 1: RED": { done: 1, total: 1 } };
    expect(currentPhase(state)).toBe("done");
  });

  test("falls through to the Acceptance criteria section once every other phase is finished", () => {
    const state = emptyState();
    state.phaseCounts = {
      "Phase 1: RED": { done: 1, total: 1 },
      "Acceptance criteria": { done: 0, total: 2 },
    };
    expect(currentPhase(state)).toBe("Acceptance criteria");
  });
});

describe("currentAcceptancePhase", () => {
  test("null when there is no Acceptance criteria section", () => {
    expect(currentAcceptancePhase(emptyState())).toBeNull();
  });

  test("null once every acceptance row is done", () => {
    const state = emptyState();
    state.phaseCounts = { "Acceptance criteria": { done: 2, total: 2 } };
    expect(currentAcceptancePhase(state)).toBeNull();
  });

  test("the heading, while a row is still open", () => {
    const state = emptyState();
    state.phaseCounts = {
      "Phase 1: RED": { done: 1, total: 1 },
      "Acceptance criteria": { done: 0, total: 2 },
    };
    expect(currentAcceptancePhase(state)).toBe("Acceptance criteria");
  });

  test("set even while an earlier phase is still current, unlike currentPhase", () => {
    const state = emptyState();
    state.phaseCounts = {
      "Phase 1: RED": { done: 0, total: 1 },
      "Acceptance criteria": { done: 0, total: 1 },
    };
    expect(currentPhase(state)).toBe("Phase 1: RED");
    expect(currentAcceptancePhase(state)).toBe("Acceptance criteria");
  });
});
