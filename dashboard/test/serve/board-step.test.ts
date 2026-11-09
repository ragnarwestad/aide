import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardStep } from "../../src/serve/board-step.ts";
import { runLogPath } from "../../src/queue/runner/run-log-path.ts";

test("a board step writes marks, notes and a completed result (AC-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-step-"));
  const streamFile = join(dir, "job.cleanup.stream.jsonl");
  const resultFile = join(dir, "result.json");
  writeFileSync(streamFile, "");
  const step = boardStep({ resultFile, streamFile, startedAt: "2026-11-09T10:00:00Z" });
  step.mark("1 of 2", "Do work", "started");
  step.note("A detail");
  step.mark("1 of 2", "Do work", "done");
  step.done();
  expect(readFileSync(runLogPath(streamFile), "utf8")).toContain("--- Step 1 of 2: Do work — done");
  expect(readFileSync(runLogPath(streamFile), "utf8")).toContain("A detail");
  expect(JSON.parse(readFileSync(resultFile, "utf8"))).toEqual({ ok: true, tool: "none", costMeasured: false, terminalReason: "completed" });
});

test("a failed board step writes an error mark and the failure result (AC-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-step-"));
  const streamFile = join(dir, "job.cleanup.stream.jsonl");
  const resultFile = join(dir, "result.json");
  writeFileSync(streamFile, "");
  const step = boardStep({ resultFile, streamFile });
  step.mark("1 of 1", "Do work", "stopped: broken");
  step.failed("cleanup-failed", "broken", { key: "cleanup.failed" } as never);
  expect(readFileSync(runLogPath(streamFile), "utf8")).toContain("error: --- Step 1 of 1: Do work — stopped: broken");
  expect(JSON.parse(readFileSync(resultFile, "utf8"))).toMatchObject({ ok: false, terminalReason: "cleanup-failed", error: "broken" });
});
