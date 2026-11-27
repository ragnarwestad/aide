// Which rows of a spec's checks the Status tab draws as boxes: the
// `## Acceptance criteria` rows only. The Phase tables and a LOW spec's
// `## Checklist` are the implement run's own record, which nothing gates on.
import { describe, expect, test } from "bun:test";
import type { SpecCheckView } from "../../../../src/render";
import { drawnAcceptanceRows } from "../../../../src/render/pages/spec-page/overview.ts";
import { view } from "../spec-page-fixtures.ts";

const row = (phase: string, task: string, done = false): SpecCheckView =>
  ({ phase, task, line: `| ${task} | ${done ? "✅" : "⬜"} | |`, done });

const drawn = (rows: SpecCheckView[]): string[] =>
  drawnAcceptanceRows(view({ checks: { rows, baseSha: "b7c40e2" } })).map((r) => r.task);

describe("drawnAcceptanceRows", () => {
  test("draws every Acceptance criteria row, done and open alike", () => {
    expect(drawn([row("Acceptance criteria", "REQ-1", true), row("Acceptance criteria", "REQ-2")])).toEqual(["REQ-1", "REQ-2"]);
  });

  test("matches the Acceptance heading whatever its case", () => {
    expect(drawn([row("ACCEPTANCE CRITERIA", "REQ-1")])).toEqual(["REQ-1"]);
  });

  test("draws no Phase row, open or in a later phase", () => {
    expect(drawn([
      row("Phase 4: REFACTOR - Test suite", "Re-read the whole diff once"),
      row("Acceptance criteria", "REQ-1"),
      row("Phase 5: SHIP - After the merge", "Watch the first real run"),
    ])).toEqual(["REQ-1"]);
  });

  test("draws no Checklist row", () => {
    expect(drawn([row("Checklist", "Run the tests")])).toEqual([]);
  });

  test("a spec with no checks draws nothing", () => {
    expect(drawnAcceptanceRows(view({ checks: undefined }))).toEqual([]);
  });
});
