// Sorting by Created when git has no date: a live spec git has not
// dated yet is the newest thing on the list; an archived or closed spec
// git could not date was made before the board recorded creation dates
// at all, and sorts as the oldest.
import { describe, expect, test } from "bun:test";
import { sortGroups, type SpecsFilter, type SpecGroup } from "../../../../src/render/pages/specs-list/data-model";

const group = (over: Partial<SpecGroup>): SpecGroup =>
  ({ project: "aide", specFolder: "1-x", state: "not-started", phases: [], spentUsd: 0, ...over }) as SpecGroup;

const byCreated = (dir: "asc" | "desc"): SpecsFilter => ({ sort: "created", dir }) as SpecsFilter;

describe("specs without a creation date", () => {
  test("an archived one sorts as the oldest, while a live undated spec sorts as the newest (AC-3)", () => {
    const old = group({ specFolder: "24-old", state: "archived" });
    const dated = group({ specFolder: "300-dated", state: "archived", createdAt: "2026-09-01T00:00:00Z" });
    const fresh = group({ specFolder: "430-fresh", state: "not-started" });
    const newestFirst = sortGroups([old, dated, fresh], byCreated("desc")).map((g) => g.specFolder);
    expect(newestFirst).toEqual(["430-fresh", "300-dated", "24-old"]);
    const oldestFirst = sortGroups([old, dated, fresh], byCreated("asc")).map((g) => g.specFolder);
    expect(oldestFirst).toEqual(["24-old", "300-dated", "430-fresh"]);
  });
});
