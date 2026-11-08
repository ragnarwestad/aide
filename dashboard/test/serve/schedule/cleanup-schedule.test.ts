import { expect, test } from "bun:test";
import { enqueueNightlyCleanup } from "../../../src/serve/process-cleanup/schedule.ts";

test("enqueues once for the local date and reuses an unfinished cleanup (AC-1, AC-3)", () => {
  const made: unknown[] = [];
  const queue = { list: () => [], enqueue: (raw: unknown) => { made.push(raw); return { ok: true, job: raw }; } };
  expect(enqueueNightlyCleanup(queue as never, "aide", new Date(2026, 10, 8, 3, 0))).toBe(true);
  expect(made).toEqual([{ project: "aide", specFolder: "cleanup", steps: ["cleanup"] }]);
  const existing = { project: "aide", specFolder: "cleanup", steps: ["cleanup"], state: "queued", createdAt: "2026-11-08T01:00:00Z" };
  expect(enqueueNightlyCleanup({ list: () => [existing], enqueue: () => { throw new Error("duplicate"); } } as never, "aide", new Date(2026, 10, 8, 4, 0))).toBe(false);
});
