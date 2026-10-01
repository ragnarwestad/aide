// Where a saved schedule entry goes next: the `back` its form carried,
// when that is a path on this board, and the entry's new page after a
// rename that moved the old one.
import { describe, expect, test } from "bun:test";
import { renamedBack, scheduleBackPath } from "../../../src/serve/routes/page-routes/schedule-edit-page.ts";

const TAB = "/projects/aide?tab=schedule";

describe("scheduleBackPath", () => {
  test("a path on this board is followed, query and all", () => {
    expect(scheduleBackPath("/schedule?q=night", TAB)).toBe("/schedule?q=night");
  });

  test("anything that could leave the board, or is not a path, gives the fallback", () => {
    for (const raw of ["//evil.example/", "/\\evil.example", "https://evil.example/", "schedule", "", "/a\r\nb", undefined, 7]) {
      expect(scheduleBackPath(raw, TAB)).toBe(TAB);
    }
  });
});

describe("renamedBack", () => {
  test("the entry's old page, with or without a query, becomes its new one", () => {
    expect(renamedBack("/schedule/aide/old", "aide", "old", "new")).toBe("/schedule/aide/new");
    expect(renamedBack("/schedule/aide/old?tab=settings", "aide", "old", "new")).toBe("/schedule/aide/new?tab=settings");
  });

  test("any other page, and a save that kept the name, is left alone", () => {
    expect(renamedBack(TAB, "aide", "old", "new")).toBe(TAB);
    expect(renamedBack("/schedule/aide/older", "aide", "old", "new")).toBe("/schedule/aide/older");
    expect(renamedBack("/schedule/aide/old", "aide", "old", "old")).toBe("/schedule/aide/old");
  });
});
