import { describe, expect, test } from "bun:test";
import {
  SCHEDULE_OUTPUT_ROUTE_PREFIX,
  isScheduleOutputPath,
  scheduleOutputRelativePath,
  scheduleRunOutputPath,
} from "../src/schedule-output-route.ts";

describe("scheduled-report route contract", () => {
  test("owns the prefix and its matching and path-building rules (AC-1)", () => {
    expect(SCHEDULE_OUTPUT_ROUTE_PREFIX).toBe("/schedule-output/");
    expect(isScheduleOutputPath("/schedule-output/aide/report.html")).toBe(true);
    expect(isScheduleOutputPath("/schedule-output")).toBe(false);
    expect(isScheduleOutputPath("/schedule-output-neighbor/report.html")).toBe(false);
    expect(scheduleOutputRelativePath("/schedule-output/aide/report.html")).toBe("/aide/report.html");
    expect(scheduleRunOutputPath("aide", "schedule-nightly", "run-1")).toBe(
      "/schedule-output/aide/schedule-nightly/runs/run-1/",
    );
  });
});
