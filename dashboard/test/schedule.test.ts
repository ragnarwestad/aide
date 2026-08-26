// Cron due-ness for a project's own recurring jobs (spec 259).
// Acceptance criteria 1-3: a schedule entry is due when the cron's most
// recent fire time is after the newest tracked job's
// `startedAt ?? createdAt`, and not before.
import { describe, expect, test } from "bun:test";
import { isDue, mostRecentFireTime, nextFireTime, scheduleTrackingKey, type ScheduleJobRef } from "../src/schedule.ts";
import type { ScheduleEntry } from "../src/parse-manifest.ts";

const ENTRY: ScheduleEntry = { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" };

describe("scheduleTrackingKey", () => {
  test("names the job-store key a schedule entry's runs are filed under", () => {
    expect(scheduleTrackingKey("nightly-report")).toBe("schedule-nightly-report");
  });
});

describe("mostRecentFireTime / nextFireTime", () => {
  test("compute around a known instant", () => {
    const now = new Date("2026-08-26T05:00:00Z");
    const prev = mostRecentFireTime(ENTRY.cron, now);
    const next = nextFireTime(ENTRY.cron, now);
    expect(prev?.toISOString()).toBe("2026-08-26T03:00:00.000Z");
    expect(next?.toISOString()).toBe("2026-08-27T03:00:00.000Z");
  });

  test("a cron string that does not parse returns null rather than throwing", () => {
    expect(mostRecentFireTime("not-a-cron", new Date())).toBeNull();
    expect(nextFireTime("not-a-cron", new Date())).toBeNull();
  });
});

describe("isDue (acceptance criteria 1-3)", () => {
  test("AC1: due when no job has ever run for this entry", () => {
    const now = new Date("2026-08-26T05:00:00Z");
    expect(isDue(ENTRY, now, [])).toBe(true);
  });

  test("AC1: due when the newest job predates the most recent fire", () => {
    const now = new Date("2026-08-26T05:00:00Z"); // most recent fire: 03:00 today
    const jobs: ScheduleJobRef[] = [
      { specFolder: "schedule-nightly-report", createdAt: "2026-08-25T03:00:01Z" },
    ];
    expect(isDue(ENTRY, now, jobs)).toBe(true);
  });

  test("AC2: not due while a job is already queued for this window (startedAt unset)", () => {
    const now = new Date("2026-08-26T05:00:00Z");
    const jobs: ScheduleJobRef[] = [
      { specFolder: "schedule-nightly-report", createdAt: "2026-08-26T03:00:05Z" },
    ];
    expect(isDue(ENTRY, now, jobs)).toBe(false);
  });

  test("AC2: not due while a job is running for this window (startedAt set)", () => {
    const now = new Date("2026-08-26T05:00:00Z");
    const jobs: ScheduleJobRef[] = [
      {
        specFolder: "schedule-nightly-report",
        createdAt: "2026-08-26T03:00:05Z",
        startedAt: "2026-08-26T03:00:10Z",
      },
    ];
    expect(isDue(ENTRY, now, jobs)).toBe(false);
  });

  test("AC3: not due when the newest tracked job is after the most recent fire, whatever its outcome", () => {
    const now = new Date("2026-08-26T05:00:00Z");
    // A job that finished (failed or not) already covers this window —
    // there is no catch-up run for a window already spent.
    const jobs: ScheduleJobRef[] = [
      {
        specFolder: "schedule-nightly-report",
        createdAt: "2026-08-26T03:00:05Z",
        startedAt: "2026-08-26T03:00:10Z",
      },
    ];
    expect(isDue(ENTRY, now, jobs)).toBe(false);
  });

  test("a job for a DIFFERENT entry never counts toward this one's due-ness", () => {
    const now = new Date("2026-08-26T05:00:00Z");
    const jobs: ScheduleJobRef[] = [
      { specFolder: "schedule-weekly-digest", createdAt: "2026-08-26T04:00:00Z" },
    ];
    expect(isDue(ENTRY, now, jobs)).toBe(true);
  });

  test("an entry whose cron does not parse is never due", () => {
    const bad: ScheduleEntry = { ...ENTRY, cron: "not-a-cron" };
    expect(isDue(bad, new Date(), [])).toBe(false);
  });
});
