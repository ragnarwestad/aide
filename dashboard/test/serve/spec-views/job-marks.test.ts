// A job's step marks as the Close and Reopen dialogs list them, and how a
// job that did not end done is read: the step it stopped at, and why.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderSentence } from "../../../src/i18n/message.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { jobMarks } from "../../../src/serve/spec-views/job-marks.ts";

const dir = mkdtempSync(join(tmpdir(), "job-marks-"));
let n = 0;
const said = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

/** A step's transcript and its run log beside it; the transcript's path. */
function step(transcript: string[], runLog: string[]): string {
  const base = join(dir, `j${n++}.close`);
  writeFileSync(`${base}.stream.jsonl`, transcript.map((l) => `${l}\n`).join(""));
  writeFileSync(`${base}.run.log`, runLog.map((l, i) => `aide-run-spec 14:58:0${i} +${i}s ${l}\n`).join(""));
  return `${base}.stream.jsonl`;
}

const job = (extra: Partial<Job>): Job =>
  ({
    id: "j",
    project: "aide",
    specFolder: "591-x",
    steps: ["close"],
    stepIndex: 0,
    state: "running",
    timeoutSec: {},
    permissionMode: {},
    model: {},
    createdAt: "2026-10-03T10:00:00Z",
    results: [],
    spentUsd: 0,
    ...extra,
  }) as Job;

const STOPPED_IN_STEP_1 = () =>
  step(
    [said("--- Step 1 of 4: Run the mechanical script — started")],
    ["--- Step Aide: preparing — started", "--- Step Aide: preparing — done", "model turn started (transcript at byte 0)"],
  );

describe("jobMarks", () => {
  test("a failed job's last running step is failed, and the reason is its error in the reader's language (AC-4)", () => {
    const error = { key: "landing.deployNoAnswer" } as const;
    const got = jobMarks(job({ state: "failed", streamFile: STOPPED_IN_STEP_1(), error }), "nb");
    expect(got.marks.map((m) => [m.title, m.state])).toEqual([
      ["Preparing", "done"],
      ["Run the mechanical script", "failed"],
    ]);
    expect(got.reason).toBe(renderSentence("nb", error)!);
  });

  test("a failed job with no error gives the failed step's own reason (AC-4)", () => {
    const file = step([], ["--- Step 4 of 4: Merge into main — started", "error: --- Step 4 of 4: Merge into main — stopped: nothing was merged"]);
    const got = jobMarks(job({ state: "failed", results: [{ step: "close", streamFile: file } as never] }), "en");
    expect(got.marks.map((m) => m.state)).toEqual(["failed"]);
    expect(got.reason).toBe("nothing was merged");
  });

  test("a done job whose merge into main stopped shows the merge failed, with the landing's reason (AC-4)", () => {
    const file = step([], [
      "--- Step Aide: tests and commit — done",
      "--- Step 4 of 4: Merge into main — started",
      "error: --- Step 4 of 4: Merge into main — stopped: nothing was merged — the close is not finished",
    ]);
    const landingError = { key: "landing.deployNoAnswer" } as const;
    const got = jobMarks(job({ state: "done", streamFile: file, landingError }), "en");
    expect(got.marks.map((m) => [m.title, m.state])).toEqual([
      ["Tests and commit", "done"],
      ["Merge into main", "failed"],
    ]);
    expect(got.reason).toBe(renderSentence("en", landingError)!);
    const unrecorded = jobMarks(job({ state: "done", streamFile: file }), "en");
    expect(unrecorded.reason).toBe("nothing was merged — the close is not finished");
  });

  test("a done job turns no line failed and gives no reason (AC-4)", () => {
    const got = jobMarks(job({ state: "done", streamFile: STOPPED_IN_STEP_1() }), "en");
    expect(got.marks.some((m) => m.state === "failed")).toBe(false);
    expect(got.reason).toBeUndefined();
  });

  test("a queued job with no stream file has no marks (AC-4)", () => {
    expect(jobMarks(job({ state: "queued" }), "en")).toEqual({ marks: [] });
  });
});
