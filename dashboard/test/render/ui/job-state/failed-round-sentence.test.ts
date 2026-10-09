// A failed reopen or close, and an analyze stopped on shared files, are said
// on the spec page's own line.

import { describe, expect, test } from "bun:test";
import * as jobState from "../../../../src/render/ui/job-state";
import { failedRoundSentence, specNotice } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";
import type { OpenOverlap } from "../../../../src/project/overlapping-specs.ts";

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

describe("failedRoundSentence (AC-4)", () => {
  for (const step of ["reopen", "close"]) {
    for (const state of ["failed", "stopped", "interrupted"] as const) {
      test(`a ${step} that ended ${state} gives its sentence`, () => {
        expect(failedRoundSentence(lead({ steps: [step], state }))).toBe("The branch could not be removed.");
      });
    }
  }

  test("a failed analyze gives nothing", () => {
    expect(failedRoundSentence(lead({ steps: ["analyze"] }))).toBeUndefined();
  });

  test("a reopen that is done gives nothing", () => {
    expect(failedRoundSentence(lead({ state: "done" }))).toBeUndefined();
  });

  test("no lead, or a lead with no sentence, gives nothing", () => {
    expect(failedRoundSentence(undefined)).toBeUndefined();
    expect(failedRoundSentence(lead({ error: undefined }))).toBeUndefined();
  });
});

describe("sharedFilesSentence", () => {
  const SENTENCE = "Analyze stopped: other open specs change the same files — 603-b: x.ts, y.ts.";
  const stoppedOn = (stopReason: NonNullable<QueueRowView["stopReason"]>, over: Partial<QueueRowView> = {}) =>
    lead({ steps: ["analyze"], state: "stopped", stopReason, error: SENTENCE, ...over });
  const OPEN: OpenOverlap[] = [
    { folder: "82-other", label: "82 The other thing", files: ["a.ts", "b.ts"] },
    { folder: "84-third", label: "84 Third", files: ["c.ts"] },
  ];
  const NAMED =
    "Analyze stopped: other open specs change the same files — 82 The other thing: a.ts, b.ts. 84 Third: c.ts. — " +
    "Add them to Depends on to wait until they are archived, or press Analyze again to go on.";
  const ARCHIVED =
    "Analyze stopped on files other open specs changed, and every one of them has been archived or removed since — " +
    "press Analyze again to go on.";
  /** The reader, and a log of how often it was asked. */
  const reading = (answer: OpenOverlap[] | undefined) => {
    const asked = { n: 0 };
    return { asked, read: () => (asked.n++, answer) };
  };

  test("a lead stopped shared-files names every spec still open, number and title, with its files (AC-1)", () => {
    expect(jobState.sharedFilesSentence(stoppedOn("shared-files"), undefined, () => OPEN)).toBe(NAMED);
  });

  test("the sentence is the same with the job and without it (AC-2)", () => {
    const withJob = jobState.sharedFilesSentence(stoppedOn("shared-files"), "shared-files", () => OPEN);
    const withoutJob = jobState.sharedFilesSentence(undefined, "shared-files", () => OPEN);
    expect(withoutJob).toBe(NAMED);
    expect(withJob).toBe(withoutJob);
  });

  test("a lead stopped for any other reason gives nothing, and the record is not read (AC-1)", () => {
    for (const reason of ["timeout", "acceptance-criteria", "provider-limit"] as const) {
      const r = reading(OPEN);
      expect(jobState.sharedFilesSentence(stoppedOn(reason), undefined, r.read)).toBeUndefined();
      expect(r.asked.n).toBe(0);
    }
  });

  test("a lead that is not stopped, and no lead and no history, give nothing (AC-1)", () => {
    const r = reading(OPEN);
    expect(jobState.sharedFilesSentence(stoppedOn("shared-files", { state: "failed" }), undefined, r.read)).toBeUndefined();
    expect(jobState.sharedFilesSentence(undefined, undefined, r.read)).toBeUndefined();
    expect(jobState.sharedFilesSentence(undefined, "timeout", r.read)).toBeUndefined();
    expect(r.asked.n).toBe(0);
  });

  test("the history alone gives nothing while the lead is in flight or ended with a sentence of its own (AC-1)", () => {
    const r = reading(OPEN);
    expect(jobState.sharedFilesSentence(lead({ state: "running", error: undefined }), "shared-files", r.read)).toBeUndefined();
    expect(jobState.sharedFilesSentence(lead({ state: "queued", error: undefined }), "shared-files", r.read)).toBeUndefined();
    expect(jobState.sharedFilesSentence(lead({ state: "failed", error: "It broke." }), "shared-files", r.read)).toBeUndefined();
    expect(jobState.sharedFilesSentence(stoppedOn("timeout"), "shared-files", r.read)).toBeUndefined();
    expect(r.asked.n).toBe(0);
  });

  test("every spec archived says so and asks only for Analyze, naming no spec and not Depends on (AC-4)", () => {
    const said = jobState.sharedFilesSentence(stoppedOn("shared-files"), "shared-files", () => []);
    expect(said).toBe(ARCHIVED);
    expect(said).not.toContain("Depends on");
  });

  test("one spec open and one archived names the open one alone (AC-3)", () => {
    const said = jobState.sharedFilesSentence(stoppedOn("shared-files"), undefined, () => OPEN.slice(0, 1));
    expect(said).toContain("82 The other thing: a.ts, b.ts.");
    expect(said).not.toContain("84");
  });

  test("with no record the lead's own sentence stands, and the history alone gives nothing (AC-2)", () => {
    const stop = stoppedOn("shared-files");
    expect(jobState.sharedFilesSentence(stop, "shared-files", () => undefined)).toBe(SENTENCE);
    expect(jobState.sharedFilesSentence(stop, undefined, () => undefined)).toBe(specNotice(stop)?.text);
    expect(jobState.sharedFilesSentence(undefined, "shared-files", () => undefined)).toBeUndefined();
  });
});
