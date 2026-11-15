import { describe, expect, test } from "bun:test";
import {
  STATE_FILTERS,
  applyFilter,
  chosenStates,
  stateFilters,
  stateFilterLabel,
  sortGroups,
  toggledState,
} from "../../../../../src/render/pages/specs-list/data-model/filter-sort.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";

const rows = [
  { project: "aide", specFolder: "1-created", state: "not-started", done: [] },
  { project: "aide", specFolder: "2-analyzed", state: "failed", done: ["analyze"] },
  { project: "aide", specFolder: "3-implemented", state: "stopped", done: ["analyze", "implement"] },
] as SpecGroup[];

describe("a state value names every ticked entry", () => {
  test("offers and matches the spec states in their fixed order (AC-14)", () => {
    expect(STATE_FILTERS.map((entry) => entry.key)).toEqual([
      "all", "not-archived", "running", "created", "reopened", "analyzed", "implemented", "archived", "closed", "not-verified",
    ]);
    expect(applyFilter(rows, { state: "analyzed,implemented" }).map((row) => row.specFolder))
      .toEqual(["2-analyzed", "3-implemented"]);
  });

  test("drops All beside another state and keeps dropdown order (AC-3, AC-6)", () => {
    expect(stateFilters("all,implemented").map((entry) => entry.key)).toEqual(["implemented"]);
    expect(stateFilters("implemented,analyzed").map((entry) => entry.key)).toEqual(["analyzed", "implemented"]);
    expect(stateFilters("implemented,no-such-entry").map((entry) => entry.key)).toEqual(["implemented"]);
  });

  test("adds and removes entries and returns to All (AC-3, AC-4)", () => {
    expect(toggledState(STATE_FILTERS, chosenStates(STATE_FILTERS, "all"), "implemented")).toBe("implemented");
    expect(toggledState(STATE_FILTERS, stateFilters("analyzed"), "implemented")).toBe("analyzed,implemented");
    expect(toggledState(STATE_FILTERS, stateFilters("implemented"), "implemented")).toBe("all");
    expect(toggledState(STATE_FILTERS, stateFilters("analyzed,implemented"), "implemented")).toBe("analyzed");
    expect(toggledState(STATE_FILTERS, stateFilters("analyzed,implemented"), "all")).toBe("all");
  });

  test("keeps the Jobs state labels while Specs uses progress states", () => {
    expect(["active:all", "waiting", "done", "stopped", "failed"].map((key) => stateFilterLabel(key, "en")))
      .toEqual(["Running", "Waiting", "Done", "Stopped", "Failed"]);
  });

  test("sorts State by the state shown for the spec", () => {
    const sorted = sortGroups(rows, { sort: "state", dir: "asc" });
    expect(sorted.map((row) => row.specFolder)).toEqual(["2-analyzed", "1-created", "3-implemented"]);
  });
});
