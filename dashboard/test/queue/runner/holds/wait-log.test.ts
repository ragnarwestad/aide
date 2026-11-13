// A job that waits in the queue says why, once it has waited long enough
// to be worth a line: the hold that keeps it, again when that hold
// changes, and once more when it starts. A short wait leaves nothing.
import { describe, expect, test } from "bun:test";
import { WAIT_LOG_AFTER_MS, WaitLog } from "../../../../src/queue/runner/wait-log.ts";
import type { Job } from "../../../../src/queue/queue.ts";

const job = { id: "c445775a-8ebc", project: "aide", specFolder: "schedule-nightly-e2e" } as Job;
const at = (ms: number) => new Date(Date.parse("2026-11-11T02:00:00.000Z") + ms).toISOString();

const logged = () => {
  const lines: string[] = [];
  return { lines, waits: new WaitLog((line) => lines.push(line)) };
};

describe("WaitLog", () => {
  test("says nothing about a job that waits less than the threshold", () => {
    const { lines, waits } = logged();
    waits.held(job, { name: "no-free-slot" }, at(0));
    waits.held(job, { name: "no-free-slot" }, at(WAIT_LOG_AFTER_MS - 1));
    waits.started(job, at(WAIT_LOG_AFTER_MS - 1));
    expect(lines).toEqual([]);
  });

  test("names the job and the hold once the wait passes the threshold, and only once", () => {
    const { lines, waits } = logged();
    waits.held(job, { name: "no-free-slot" }, at(0));
    waits.held(job, { name: "no-free-slot" }, at(WAIT_LOG_AFTER_MS));
    waits.held(job, { name: "no-free-slot" }, at(WAIT_LOG_AFTER_MS + 60_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("aide/schedule-nightly-e2e");
    expect(lines[0]).toContain("c445775a");
    expect(lines[0]).toContain("no-free-slot");
  });

  test("writes the hold's sentence when it has one", () => {
    const { lines, waits } = logged();
    const reason = { key: "runner.usageLimitHeld", values: { provider: "Claude", at: "06:00" } } as const;
    waits.held(job, { name: "usage-limit", reason }, at(0));
    waits.held(job, { name: "usage-limit", reason }, at(WAIT_LOG_AFTER_MS));
    expect(lines[0]).toContain("usage limit");
  });

  test("logs again when the hold changes, and when the job starts", () => {
    const { lines, waits } = logged();
    waits.held(job, { name: "usage-limit" }, at(0));
    waits.held(job, { name: "usage-limit" }, at(WAIT_LOG_AFTER_MS));
    waits.held(job, { name: "no-free-slot" }, at(WAIT_LOG_AFTER_MS + 1000));
    waits.started(job, at(WAIT_LOG_AFTER_MS + 2000));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("no-free-slot");
    expect(lines[2]).toContain("starts");
  });

  test("forgets a job that is no longer queued", () => {
    const { lines, waits } = logged();
    waits.held(job, { name: "no-free-slot" }, at(0));
    waits.keepOnly(new Set());
    waits.held(job, { name: "no-free-slot" }, at(WAIT_LOG_AFTER_MS));
    expect(lines).toEqual([]);
  });
});
