// A job's step marks as a Close's or Reopen's line on the Running page lists
// them, and how a job that did not end done is read: the step it stopped at,
// and why.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderSentence } from "../../../src/i18n/message.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { stepPlan } from "../../../src/queue/parse-stream";
import { closeOrReopenSteps, jobMarks } from "../../../src/serve/spec-views/job-marks.ts";

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

describe("closeOrReopenSteps", () => {
  // The line lists every step Close's skill plans from the start, and the
  // log moves each one: the dialog's list, followed on the Running page.
  test("every planned step is listed, each in the state the log has it in", () => {
    const got = closeOrReopenSteps(job({ streamFile: STOPPED_IN_STEP_1() }), "close", "en");
    const plan = stepPlan("close");
    expect(plan.length).toBeGreaterThan(2);
    expect(got.map((s) => s.key)).toEqual(plan.map((p) => p.key));
    const state = (key: string) => got.find((s) => s.key === key)?.state;
    expect(state("Step Aide: preparing")).toBe("done");
    expect(state("Step 1 of 4")).toBe("running");
    expect(got.filter((s) => s.state === undefined)).toHaveLength(plan.length - 2);
  });

  // Aide's own steps carry the run log's `+Ns` stamps: an ended one its
  // seconds, a running one the moment it started. The model's steps have none.
  test("an ended Aide step has its seconds, a running one when it started, a model step neither", () => {
    const file = step(
      [said("--- Step 1 of 4: Run the mechanical script — started"), said("--- Step 1 of 4: Run the mechanical script — done")],
      [
        "--- Step Aide: preparing — started",
        "--- Step Aide: preparing — done",
        "model turn started (transcript at byte 0)",
        "--- Step Aide: tests and commit — started",
      ],
    );
    const got = closeOrReopenSteps(job({ streamFile: file, stepStartedAt: "2026-10-03T10:00:00Z" }), "close", "en");
    const of = (key: string) => got.find((s) => s.key === key);
    expect(of("Step Aide: preparing")?.seconds).toBe(1);
    expect(of("Step Aide: tests and commit")).toMatchObject({ state: "running", since: "2026-10-03T10:00:03.000Z" });
    expect(of("Step 1 of 4")?.seconds).toBeUndefined();
  });
});
