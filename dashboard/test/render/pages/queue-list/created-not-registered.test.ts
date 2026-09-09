// The Created column's two readings of "no date" (2026-09-09): a live
// spec git has not dated yet is the newest thing on the list and shows
// a dash; an archived or closed spec git could not date was made before
// the board recorded creation dates at all — it says so, and sorts as
// the oldest.
import { describe, expect, test } from "bun:test";
import { createdCell } from "../../../../src/render/pages/queue-list/cell-helpers.ts";
import { sortGroups, type QueueFilter, type SpecGroup } from "../../../../src/render/pages/queue-list/data-model.ts";

const group = (over: Partial<SpecGroup>): SpecGroup =>
  ({ project: "aide", specFolder: "1-x", state: "not-started", phases: [], spentUsd: 0, ...over }) as SpecGroup;

const byCreated = (dir: "asc" | "desc"): QueueFilter => ({ sort: "created", dir }) as QueueFilter;

describe("an archived spec without a creation date", () => {
  test("reads 'not registered', in the reader's language, never the dash", () => {
    expect(createdCell(undefined, false, true, "en")).toBe("not registered");
    expect(createdCell(undefined, false, true, "nb")).toBe("ikke registrert");
  });

  test("a live spec without one keeps the dash, and a dated one its date", () => {
    expect(createdCell(undefined, false, false, "nb")).toBe("–");
    expect(createdCell("2026-09-09T10:00:00Z", false, true, "nb")).toBe("2026-09-09");
  });

  test("sorts as the oldest, while a live undated spec sorts as the newest", () => {
    const old = group({ specFolder: "24-old", state: "archived" });
    const dated = group({ specFolder: "300-dated", state: "archived", createdAt: "2026-09-01T00:00:00Z" });
    const fresh = group({ specFolder: "430-fresh", state: "not-started" });
    const newestFirst = sortGroups([old, dated, fresh], byCreated("desc")).map((g) => g.specFolder);
    expect(newestFirst).toEqual(["430-fresh", "300-dated", "24-old"]);
    const oldestFirst = sortGroups([old, dated, fresh], byCreated("asc")).map((g) => g.specFolder);
    expect(oldestFirst).toEqual(["24-old", "300-dated", "430-fresh"]);
  });
});
