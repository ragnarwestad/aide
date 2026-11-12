import { describe, expect, test } from "bun:test";
import {
  STATE_FILTERS,
  applyFilter,
  chosenStates,
  stateFilters,
  toggledState,
} from "../../../../../src/render/pages/specs-list/data-model/filter-sort.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";

const rows = [
  { project: "aide", specFolder: "1-running", state: "running" },
  { project: "aide", specFolder: "2-stopped", state: "stopped" },
  { project: "aide", specFolder: "3-failed", state: "failed" },
] as SpecGroup[];

describe("a state value names every ticked entry", () => {
  test("keeps rows matching any ticked state (AC-2)", () => {
    expect(applyFilter(rows, { state: "stopped,failed" }).map((row) => row.specFolder))
      .toEqual(["2-stopped", "3-failed"]);
  });

  test("drops All beside another state and keeps dropdown order (AC-3, AC-6)", () => {
    expect(stateFilters("all,failed").map((entry) => entry.key)).toEqual(["failed"]);
    expect(stateFilters("failed,stopped").map((entry) => entry.key)).toEqual(["stopped", "failed"]);
    expect(stateFilters("failed,no-such-entry").map((entry) => entry.key)).toEqual(["failed"]);
  });

  test("adds and removes entries and returns to All (AC-3, AC-4)", () => {
    expect(toggledState(STATE_FILTERS, chosenStates(STATE_FILTERS, "all"), "failed")).toBe("failed");
    expect(toggledState(STATE_FILTERS, stateFilters("stopped"), "failed")).toBe("stopped,failed");
    expect(toggledState(STATE_FILTERS, stateFilters("failed"), "failed")).toBe("all");
    expect(toggledState(STATE_FILTERS, stateFilters("stopped,failed"), "failed")).toBe("stopped");
    expect(toggledState(STATE_FILTERS, stateFilters("stopped,failed"), "all")).toBe("all");
  });
});
