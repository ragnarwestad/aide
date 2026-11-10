// An analyze stopped on shared files, said on the row from the spec's own record.

import { describe, expect, test } from "bun:test";
import * as jobState from "../../../../src/render/ui/job-state";
import { getSpecMessage } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";
import type { OpenOverlap } from "../../../../src/project/overlapping-specs.ts";
import { formatMessage } from "../../../../src/messages/format.ts";

const lead = (over: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "j1",
  project: "aide",
  specFolder: "1-x",
  steps: ["reopen"],
  stepIndex: 0,
  state: "failed",
  spentUsd: 0,
  timeoutSec: 600,
  createdAt: "2026-09-03T00:00:00Z",
  error: "The branch could not be removed.",
  ...over,
});

describe("getSharedFilesMessage", () => {
  const SENTENCE = "Analyze stopped: other open specs change the same files — 603-b: x.ts, y.ts.";
  const stoppedOn = (stopReason: NonNullable<QueueRowView["stopReason"]>, over: Partial<QueueRowView> = {}) =>
    lead({ steps: ["analyze"], state: "stopped", stopReason, error: SENTENCE, ...over });
  const OPEN: OpenOverlap[] = [
    { folder: "82-other", label: "82 The other thing", files: ["a.ts", "b.ts"] },
    { folder: "84-third", label: "84 Third", files: ["c.ts"] },
  ];
  const NAMED = formatMessage("en", {
    key: "wordPhase.stopSharedFilesNamed",
    values: { button: "Analyze" },
    inner: [
      { key: "runner.sharedFilesSpec", values: { spec: "82 The other thing", files: "a.ts, b.ts" } },
      { key: "runner.sharedFilesSpec", values: { spec: "84 Third", files: "c.ts" } },
    ],
  });
  const ARCHIVED =
    "Problem: Analyze stopped on files other open specs changed, and every one of them has been archived or removed since\n" +
    "Solution: Press Analyze again to go on";
  /** The reader, and a log of how often it was asked. */
  const reading = (answer: OpenOverlap[] | undefined) => {
    const asked = { n: 0 };
    return { asked, read: () => {
      asked.n++;
      return answer;
    } };
  };

  test("a lead stopped shared-files names every spec still open, number and title, with its files, and tells the reader to add them to Depends on", () => {
    expect(jobState.getSharedFilesMessage(stoppedOn("shared-files"), undefined, () => OPEN)).toBe(NAMED);
  });

  test("the sentence is the same with the job and without it", () => {
    const withJob = jobState.getSharedFilesMessage(stoppedOn("shared-files"), "shared-files", () => OPEN);
    const withoutJob = jobState.getSharedFilesMessage(undefined, "shared-files", () => OPEN);
    expect(withoutJob).toBe(NAMED);
    expect(withJob).toBe(withoutJob);
  });

  test("a lead stopped for any other reason gives nothing, and the record is not read", () => {
    for (const reason of ["timeout", "acceptance-criteria", "provider-limit"] as const) {
      const r = reading(OPEN);
      expect(jobState.getSharedFilesMessage(stoppedOn(reason), undefined, r.read)).toBeUndefined();
      expect(r.asked.n).toBe(0);
    }
  });

  test("a lead that is not stopped, and no lead and no history, give nothing", () => {
    const r = reading(OPEN);
    expect(jobState.getSharedFilesMessage(stoppedOn("shared-files", { state: "failed" }), undefined, r.read)).toBeUndefined();
    expect(jobState.getSharedFilesMessage(undefined, undefined, r.read)).toBeUndefined();
    expect(jobState.getSharedFilesMessage(undefined, "timeout", r.read)).toBeUndefined();
    expect(r.asked.n).toBe(0);
  });

  test("the history alone gives nothing while the lead is in flight or ended with a sentence of its own", () => {
    const r = reading(OPEN);
    expect(jobState.getSharedFilesMessage(lead({ state: "running", error: undefined }), "shared-files", r.read)).toBeUndefined();
    expect(jobState.getSharedFilesMessage(lead({ state: "queued", error: undefined }), "shared-files", r.read)).toBeUndefined();
    expect(jobState.getSharedFilesMessage(lead({ state: "failed", error: "It broke." }), "shared-files", r.read)).toBeUndefined();
    expect(jobState.getSharedFilesMessage(stoppedOn("timeout"), "shared-files", r.read)).toBeUndefined();
    expect(r.asked.n).toBe(0);
  });

  test("every spec archived says so and asks only for Analyze, naming no spec and not Depends on", () => {
    const said = jobState.getSharedFilesMessage(stoppedOn("shared-files"), "shared-files", () => []);
    expect(said).toBe(ARCHIVED);
    expect(said).not.toContain("Depends on");
  });

  test("one spec open and one archived names the open one alone", () => {
    const said = jobState.getSharedFilesMessage(stoppedOn("shared-files"), undefined, () => OPEN.slice(0, 1));
    expect(said).toContain("82 The other thing: a.ts, b.ts");
    expect(said).not.toContain("84");
  });

  test("with no record the lead's own sentence stands, and the history alone gives nothing", () => {
    const stop = stoppedOn("shared-files");
    expect(jobState.getSharedFilesMessage(stop, "shared-files", () => undefined)).toBe(SENTENCE);
    expect(jobState.getSharedFilesMessage(stop, undefined, () => undefined)).toBe(getSpecMessage(stop)?.text);
    expect(jobState.getSharedFilesMessage(undefined, "shared-files", () => undefined)).toBeUndefined();
  });
});
