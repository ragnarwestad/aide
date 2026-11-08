// How many test workers a run may use: the cores divided among the steps and
// landings running. `test_workers_share` (core/scripts/lib/run-spec/turn/test-workers.sh)
// makes the same decision for a step's own runs, and
// core/tests/fixtures/test-workers.json pins both.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BusyJob, testWorkerShare } from "../../src/queue/test-workers.ts";

const CASES = JSON.parse(readFileSync(join(import.meta.dir, "../../../core/tests/fixtures/test-workers.json"), "utf-8"))
  .cases as { name: string; cores: number; jobs: BusyJob[]; workers: number }[];

describe("testWorkerShare", () => {
  test.each(CASES)("$name (AC-1)", ({ cores, jobs, workers }) => {
    expect(testWorkerShare(cores, jobs)).toBe(workers);
  });
});
