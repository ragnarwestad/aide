// A failed reopen or close, and an analyze stopped on shared files, are said
// on the spec page's own line.

import { describe, expect, test } from "bun:test";
import * as jobState from "../../../../src/render/ui/job-state";
import { failedRoundSentence, specNotice } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";

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

  test("a lead stopped shared-files gives the same sentence as the row (AC-3)", () => {
    const stop = stoppedOn("shared-files");
    expect(jobState.sharedFilesSentence(stop)).toBe(SENTENCE);
    expect(jobState.sharedFilesSentence(stop)).toBe(specNotice(stop)?.text);
  });

  test("a lead stopped for any other reason gives nothing (AC-3)", () => {
    for (const reason of ["timeout", "acceptance-criteria", "provider-limit"] as const) {
      expect(jobState.sharedFilesSentence(stoppedOn(reason))).toBeUndefined();
    }
  });

  test("a lead that is not stopped, no lead, and a lead with no sentence give nothing (AC-3)", () => {
    expect(jobState.sharedFilesSentence(stoppedOn("shared-files", { state: "failed" }))).toBeUndefined();
    expect(jobState.sharedFilesSentence(undefined)).toBeUndefined();
    expect(jobState.sharedFilesSentence(stoppedOn("shared-files", { error: undefined }))).toBeUndefined();
  });
});
