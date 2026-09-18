// Spec 495, criteria 14 and 16: a run's own output directory, and the one
// function that says whether a run wrote a report.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readScheduleRunReport, scheduleRunOutputDir } from "../../src/queue/schedule.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function rootWith(runId: string, file: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "aide-run-output-"));
  dirs.push(root);
  const dir = scheduleRunOutputDir(root, "aide", "schedule-nightly", runId);
  mkdirSync(dir, { recursive: true });
  if (file !== null) writeFileSync(join(dir, "index.html"), file);
  return root;
}

describe("scheduleRunOutputDir", () => {
  test("is <root>/<project>/<key>/runs/<jobId>, and differs per run", () => {
    expect(scheduleRunOutputDir("/r", "aide", "schedule-nightly", "j1")).toBe("/r/aide/schedule-nightly/runs/j1");
    expect(scheduleRunOutputDir("/r", "aide", "schedule-nightly", "j2")).not.toBe(
      scheduleRunOutputDir("/r", "aide", "schedule-nightly", "j1"),
    );
  });
});

describe("readScheduleRunReport", () => {
  test("returns the text of a real report", () => {
    const root = rootWith("j1", "<h1>Findings</h1><p>All green</p>");
    expect(readScheduleRunReport(root, "aide", "schedule-nightly", "j1")).toContain("All green");
  });

  test("a report that is only an image is a report", () => {
    const root = rootWith("j1", '<img src="chart.png">');
    expect(readScheduleRunReport(root, "aide", "schedule-nightly", "j1")).not.toBeNull();
  });

  test("a missing directory, a missing file, an empty file, whitespace and empty tags are no report", () => {
    expect(readScheduleRunReport("/nonexistent-root", "aide", "schedule-nightly", "j1")).toBeNull();
    expect(readScheduleRunReport(rootWith("j1", null), "aide", "schedule-nightly", "j1")).toBeNull();
    for (const blank of ["", "  \n\t ", "<html><body><div></div><p> </p></body></html>"]) {
      expect(readScheduleRunReport(rootWith("j1", blank), "aide", "schedule-nightly", "j1")).toBeNull();
    }
  });

  test("another run's report is never read for this run", () => {
    const root = rootWith("j1", "<p>run one</p>");
    expect(readScheduleRunReport(root, "aide", "schedule-nightly", "j2")).toBeNull();
  });
});
