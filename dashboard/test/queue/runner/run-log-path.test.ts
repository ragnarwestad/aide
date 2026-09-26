// The step's own run log: the file the runner's stderr goes to, named from
// its transcript so the write side (the spawn) and the read side (the job
// page) cannot disagree.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { openRunLog, runLogPath } from "../../../src/queue/runner/run-log-path.ts";

describe("runLogPath", () => {
  test("is the run log beside the transcript, and two steps of one job give two paths (AC-3)", () => {
    expect(runLogPath("/jobs/job-1.implement.stream.jsonl")).toBe("/jobs/job-1.implement.run.log");
    expect(runLogPath("/jobs/job-1.analyze.stream.jsonl")).not.toBe(runLogPath("/jobs/job-1.implement.stream.jsonl"));
  });
});

describe("openRunLog", () => {
  test("empties a file that already held text before the spawn writes into it (AC-3)", async () => {
    const stream = join(mkdtempSync(join(tmpdir(), "run-log-")), "job-1.implement.stream.jsonl");
    writeFileSync(runLogPath(stream), "an earlier attempt, and a long one\n");
    const file = openRunLog(stream);
    expect(readFileSync(runLogPath(stream), "utf-8")).toBe("");
    await Bun.write(file, "short\n");
    expect(readFileSync(runLogPath(stream), "utf-8")).toBe("short\n");
  });
});
