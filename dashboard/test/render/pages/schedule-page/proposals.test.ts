// The "Proposed specs" list under a run's report: what was created, what was
// skipped and why, in the reader's language.
import { describe, expect, test } from "bun:test";
import { scheduleRunPath, schedulePagePath } from "../../../../src/render";

describe("scheduleRunPath", () => {
  test("is the entry's page with the run and the report anchor (AC-5)", () => {
    expect(scheduleRunPath("aide", "nyhetssjekk", "run 1")).toBe(`${schedulePagePath("aide", "nyhetssjekk")}?run=run%201#report`);
    expect(scheduleRunPath("aide", "nyhetssjekk", "run-1")).toBe("/schedule/aide/nyhetssjekk?run=run-1#report");
  });
});
