import { describe, expect, test } from "bun:test";
import {
  STATE_FILTERS,
  applyFilter,
  chosenStates,
  stateFilters,
  sortGroups,
  toggledState,
} from "../../../../../src/render/pages/specs-list/data-model/filter-sort.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";

const rows = [
  { project: "aide", specFolder: "1-created", state: "not-started", done: [] },
  { project: "aide", specFolder: "2-idle", state: "failed", done: ["analyze"] },
  { project: "aide", specFolder: "3-active", state: "running", done: ["analyze"], lead: { state: "running", steps: ["implement"], stepIndex: 0 } },
] as SpecGroup[];

describe("a state value names every ticked entry", () => {
  test("offers and matches the requested spec states in their fixed order (AC-5, AC-6, AC-7)", () => {
    expect(STATE_FILTERS.map((entry) => entry.key)).toEqual([
      "all", "not-archived", "active", "created", "idle", "reopened", "archived", "closed", "not-verified",
    ]);
    expect(applyFilter(rows, { state: "idle,active" }).map((row) => row.specFolder))
      .toEqual(["2-idle", "3-active"]);
  });

  test("drops All beside another state and keeps dropdown order (AC-3, AC-6)", () => {
    expect(stateFilters("all,idle").map((entry) => entry.key)).toEqual(["idle"]);
    expect(stateFilters("idle,active").map((entry) => entry.key)).toEqual(["active", "idle"]);
    expect(stateFilters("idle,no-such-entry").map((entry) => entry.key)).toEqual(["idle"]);
  });

  test("clears every state or toggles individual states from All", () => {
    const all = chosenStates(STATE_FILTERS, "all");
    expect(toggledState(STATE_FILTERS, all, "idle"))
      .toBe("not-archived,active,created,reopened,archived,closed,not-verified");
    expect(toggledState(STATE_FILTERS, all, "none")).toBe("none");
    expect(applyFilter(rows, { state: "none" })).toEqual([]);
    expect(toggledState(STATE_FILTERS, stateFilters("none"), "idle")).toBe("idle");
    expect(toggledState(STATE_FILTERS, stateFilters("active"), "idle")).toBe("active,idle");
    expect(toggledState(STATE_FILTERS, stateFilters("idle"), "idle")).toBe("none");
    expect(toggledState(STATE_FILTERS, stateFilters("active,idle"), "idle")).toBe("active");
    expect(toggledState(STATE_FILTERS, stateFilters("active,idle"), "all")).toBe("all");
  });

  test("sorts State by the state shown for the spec", () => {
    const sorted = sortGroups(rows, { sort: "state", dir: "asc" });
    expect(sorted.map((row) => row.specFolder)).toEqual(["3-active", "1-created", "2-idle"]);
  });

  test("sorts by localized first action in either direction (AC-10)", () => {
    const labels = new Map([["1-created", "Run"], ["2-idle", "Close"], ["3-active", "Reopen"]]);
    expect(sortGroups(rows, { sort: "actions", dir: "asc" }, (row) => labels.get(row.specFolder)!, "en").map((row) => row.specFolder))
      .toEqual(["2-idle", "3-active", "1-created"]);
    expect(sortGroups(rows, { sort: "actions", dir: "desc" }, (row) => labels.get(row.specFolder)!, "en").map((row) => row.specFolder))
      .toEqual(["1-created", "3-active", "2-idle"]);
  });
});
