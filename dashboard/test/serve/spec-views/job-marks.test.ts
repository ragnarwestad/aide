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
import { closeOrReopenSteps, deploySteps, jobMarks, scheduleSteps } from "../../../src/serve/spec-views/job-marks.ts";

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

/** A transcript and a run log whose lines carry the stamps given: `[seconds into the run, text]`. */
function stamped(transcript: string[], runLog: [number, string][]): string {
  const base = join(dir, `j${n++}.close`);
  writeFileSync(`${base}.stream.jsonl`, transcript.map((l) => `${l}\n`).join(""));
  writeFileSync(`${base}.run.log`, runLog.map(([sec, l]) => `aide-run-spec 14:58:00 +${sec}s ${l}\n`).join(""));
  return `${base}.stream.jsonl`;
}
const used = (id: string, text: string, tokens: number) =>
  JSON.stringify({
    type: "assistant",
    message: { id, content: [{ type: "text", text }], usage: { input_tokens: tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });

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
  test("a failed job's last running step is failed, and the reason is its error in the reader's language", () => {
    const error = { key: "landing.deployNoAnswer" } as const;
    const got = jobMarks(job({ state: "failed", streamFile: STOPPED_IN_STEP_1(), error }), "nb");
    expect(got.marks.map((m) => [m.title, m.state])).toEqual([
      ["Preparing", "done"],
      ["Run the mechanical script", "failed"],
    ]);
    expect(got.reason).toBe(renderSentence("nb", error)!);
  });

  test("a failed job with no error gives the failed step's own reason", () => {
    const file = step([], ["--- Step 4 of 4: Merge into main — started", "error: --- Step 4 of 4: Merge into main — stopped: nothing was merged"]);
    const got = jobMarks(job({ state: "failed", results: [{ step: "close", streamFile: file } as never] }), "en");
    expect(got.marks.map((m) => m.state)).toEqual(["failed"]);
    expect(got.reason).toBe("nothing was merged");
  });

  test("a done job whose merge into main stopped shows the merge failed, with the landing's reason", () => {
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

  test("a done job turns no line failed and gives no reason", () => {
    const got = jobMarks(job({ state: "done", streamFile: STOPPED_IN_STEP_1() }), "en");
    expect(got.marks.some((m) => m.state === "failed")).toBe(false);
    expect(got.reason).toBeUndefined();
  });

  test("a queued job with no stream file has no marks", () => {
    expect(jobMarks(job({ state: "queued" }), "en")).toEqual({ marks: [], logs: [] });
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

  // A step carries the run log's `+Ns` stamps: an ended one its seconds, a running
  // one the moment it started. A model's step has them when the runner recorded its marks.
  test("an ended Aide step has its seconds, a running one when it started, and a model step marked in a run from before neither", () => {
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
    expect(of("Step 1 of 4")?.since).toBeUndefined();
  });

  const MARKED = [
    said("--- Step 1 of 4: Run the mechanical script — started"),
    said("--- Step 1 of 4: Run the mechanical script — done"),
    said("--- Step 2 of 4: Commit & push — started"),
  ];
  const LOG: [number, string][] = [
    [0, "--- Step Aide: preparing — started"],
    [3, "--- Step Aide: preparing — done"],
    [4, "model turn started (transcript at byte 0)"],
    [5, "--- Step 1 of 4: Run the mechanical script — started"],
    [47, "--- Step 1 of 4: Run the mechanical script — done"],
    [50, "--- Step 2 of 4: Commit & push — started"],
  ];
  const START = "2026-10-03T10:00:00Z";

  test("a step the model marked has its seconds once done, and a count from its start while it runs", () => {
    const got = closeOrReopenSteps(job({ streamFile: stamped(MARKED, LOG), stepStartedAt: START }), "close", "en");
    const of = (key: string) => got.find((s) => s.key === key);
    expect(of("Step 1 of 4")?.seconds).toBe(42);
    expect(of("Step 2 of 4")?.seconds).toBeUndefined();
    expect(of("Step 2 of 4")?.since).toBe("2026-10-03T10:00:50.000Z");
  });

  test("a step the model never ended runs until Aide's next step starts", () => {
    const log: [number, string][] = [...LOG, [90, "--- Step Aide: tests and commit — started"]];
    const got = closeOrReopenSteps(job({ streamFile: stamped(MARKED, log), stepStartedAt: START }), "close", "en");
    expect(got.find((s) => s.key === "Step 2 of 4")?.seconds).toBe(40);
  });

  test("a step the log left running on a job that is no longer running does not count", () => {
    const got = closeOrReopenSteps(job({ state: "done", streamFile: stamped(MARKED, LOG), stepStartedAt: START }), "close", "en");
    const two = got.find((s) => s.key === "Step 2 of 4");
    expect(two?.since).toBeUndefined();
    expect(two?.seconds).toBeUndefined();
  });

  test("the tokens used between a step's marks reach its line, and a step with none has no key", () => {
    const transcript = [
      used("m1", "--- Step 1 of 4: Run the mechanical script — started", 100),
      used("m2", "--- Step 1 of 4: Run the mechanical script — done", 25),
      said("--- Step 2 of 4: Commit & push — started"),
    ];
    const got = closeOrReopenSteps(job({ streamFile: stamped(transcript, LOG), stepStartedAt: START }), "close", "en");
    expect(got.find((s) => s.key === "Step 1 of 4")?.tokens).toBe(125);
    expect(got.find((s) => s.key === "Step 2 of 4")).not.toHaveProperty("tokens");
  });

  test("a run from before shows no tokens, whatever its transcript holds", () => {
    const transcript = [used("m1", "--- Step 1 of 4: Run the mechanical script — started", 100), used("m2", "--- Step 1 of 4: Run the mechanical script — done", 25)];
    const file = step(transcript, ["--- Step Aide: preparing — started", "model turn started (transcript at byte 0)"]);
    const got = closeOrReopenSteps(job({ streamFile: file, stepStartedAt: START }), "close", "en");
    expect(got.find((s) => s.key === "Step 1 of 4")).not.toHaveProperty("tokens");
  });
});

describe("a step's own log", () => {
  test("a marked step carries its part of the job's Log, a waiting one none", () => {
    const file = step(
      [said("--- Step 1 of 4: Run the mechanical script — started"), said("moved the folder")],
      ["--- Step Aide: preparing — started", "pulled main", "--- Step Aide: preparing — done", "model turn started (transcript at byte 0)"],
    );
    const got = closeOrReopenSteps(job({ streamFile: file }), "close", "en");
    const text = (key: string) => (got.find((s) => s.key === key)?.logs ?? []).flatMap((p) => p.lines).join("\n");
    expect(text("Step Aide: preparing")).toContain("pulled main");
    expect(text("Step Aide: preparing")).not.toContain("moved the folder");
    expect(text("Step 1 of 4")).toContain("moved the folder");
    expect(got.find((s) => s.state === undefined)?.logs).toBeUndefined();
  });
});

describe("deploySteps", () => {
  const deployJob = (file: string, extra: Partial<Job> = {}) =>
    job({ specFolder: "deploy", steps: ["deploy"], streamFile: file, stepStartedAt: "2026-10-03T10:00:00Z", ...extra });
  const KEYS = ["Step 1 of 5", "Step 2 of 5", "Step 3 of 5", "Step 4 of 5", "Step 5 of 5"];

  // The run is cut at the restart: what it has marked is the fetch, the
  // install and the restart. The wait and the check are not marked yet.
  test("lists the five deploy steps in order, each in the state the run log has it in", () => {
    const file = step([], [
      "--- Step 1 of 5: Fetch from origin — started",
      "--- Step 1 of 5: Fetch from origin — done",
      "--- Step 2 of 5: Install — started",
      "--- Step 2 of 5: Install — done",
      "--- Step 3 of 5: Restart the service — started",
    ]);
    const got = deploySteps(deployJob(file), "en");
    expect(got.map((s) => s.key)).toEqual(KEYS);
    expect(got.map((s) => s.state)).toEqual(["done", "done", "running", undefined, undefined]);
    expect(got[0]!.seconds).toBe(1);
    expect(got[1]!.seconds).toBe(1);
    expect(got[2]).toMatchObject({ since: "2026-10-03T10:00:04.000Z" });
  });

  // The process that starts after the restart writes its marks to the same
  // log, its seconds counted from the job's `stepStartedAt`.
  test("lines marked after the restart read done, each with its seconds", () => {
    const file = step([], [
      "--- Step 1 of 5: Fetch from origin — started",
      "--- Step 1 of 5: Fetch from origin — done",
      "--- Step 3 of 5: Restart the service — started",
      "--- Step 3 of 5: Restart the service — done",
      "--- Step 4 of 5: Wait for the service to answer — started",
      "--- Step 4 of 5: Wait for the service to answer — done",
      "--- Step 5 of 5: Check the newest commit runs — started",
      "--- Step 5 of 5: Check the newest commit runs — done",
    ]);
    const got = deploySteps(deployJob(file), "en");
    expect(got.slice(2).map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(got[3]!.seconds).toBe(1);
    expect(got[4]!.seconds).toBe(1);
  });

  test("a deploy with nothing marked yet lists the five steps, none with a state", () => {
    const got = deploySteps(job({ specFolder: "deploy", steps: ["deploy"], state: "queued" }), "en");
    expect(got.map((s) => s.key)).toEqual(KEYS);
    expect(got.every((s) => s.state === undefined)).toBe(true);
  });
});

describe("scheduleSteps", () => {
  const scheduled = (extra: Partial<Job>): Job => job({ specFolder: "schedule-nightly", steps: ["schedule"], stepStartedAt: "2026-10-03T10:00:00Z", ...extra });
  const marked = () =>
    step(
      [
        said("--- Step 1 of 2: Read the list — started"),
        said("read the list line"),
        said("--- Step 1 of 2: Read the list — done"),
        said("--- Step 2 of 2: Write the report — started"),
        said("wrote the report line"),
      ],
      ["--- Step Aide: preparing — started", "--- Step Aide: preparing — done", "model turn started (transcript at byte 0)"],
    );

  test("lists only the steps the log has marked, in the order marked, each in its state", () => {
    const got = scheduleSteps(scheduled({ streamFile: marked() }), "en");
    expect(got.map((s) => [s.label, s.state])).toEqual([
      ["Preparing", "done"],
      ["Read the list", "done"],
      ["Write the report", "running"],
    ]);
  });

  test("Aide's step has its seconds from the run log and a model's step marked in a run from before has none", () => {
    const got = scheduleSteps(scheduled({ streamFile: marked() }), "en");
    expect(got[0]!.seconds).toBe(1);
    expect(got[1]!.seconds).toBeUndefined();
    expect(got[2]!.seconds).toBeUndefined();
  });

  test("the model's steps have their seconds when the runner recorded their marks", () => {
    const file = stamped(
      [said("--- Step 1 of 2: Read the list — started"), said("--- Step 1 of 2: Read the list — done"), said("--- Step 2 of 2: Write the report — started")],
      [
        [0, "--- Step Aide: preparing — started"],
        [2, "--- Step Aide: preparing — done"],
        [3, "model turn started (transcript at byte 0)"],
        [4, "--- Step 1 of 2: Read the list — started"],
        [19, "--- Step 1 of 2: Read the list — done"],
        [20, "--- Step 2 of 2: Write the report — started"],
      ],
    );
    const got = scheduleSteps(scheduled({ streamFile: file }), "en");
    expect(got[1]!.seconds).toBe(15);
    expect(got[2]).toMatchObject({ state: "running", since: "2026-10-03T10:00:20.000Z" });
  });

  test("a step whose title makes its started mark too long for the Log's clip has its seconds as well", () => {
    // 17 characters of mark before the title and 10 after it: 135 makes the started mark 162 long and the done mark 159.
    const title = "t".repeat(135);
    const start1 = `--- Step 1 of 2: ${title} — started`;
    const done1 = `--- Step 1 of 2: ${title} — done`;
    const file = stamped(
      [said(start1), said(done1), said("--- Step 2 of 2: Write the report — started"), said("--- Step 2 of 2: Write the report — done")],
      [
        [0, "--- Step Aide: preparing — started"],
        [2, "--- Step Aide: preparing — done"],
        [3, "model turn started (transcript at byte 0)"],
        [4, start1],
        [19, done1],
        [20, "--- Step 2 of 2: Write the report — started"],
        [30, "--- Step 2 of 2: Write the report — done"],
      ],
    );
    const got = scheduleSteps(scheduled({ streamFile: file }), "en");
    expect(got.map((s) => [s.state, s.seconds])).toEqual([["done", 2], ["done", 15], ["done", 10]]);
  });

  test("a queued job with no log yet has no steps", () => {
    expect(scheduleSteps(scheduled({ state: "queued", streamFile: undefined }), "en")).toEqual([]);
  });

  test("each step carries its own part of the log", () => {
    const got = scheduleSteps(scheduled({ streamFile: marked() }), "en");
    const text = (label: string) => (got.find((s) => s.label === label)?.logs ?? []).flatMap((p) => p.lines).join("\n");
    expect(text("Write the report")).toContain("wrote the report line");
    expect(text("Read the list")).toContain("read the list line");
    expect(text("Read the list")).not.toContain("wrote the report line");
  });
});
