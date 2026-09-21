// A failed reopen or close is said on the spec page's own error line.

import { describe, expect, test } from "bun:test";
import { failedRoundSentence } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";
import { page, view } from "../../pages/spec-page-fixtures.ts";

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

  test("the spec page draws the sentence as the failed paragraph a failed Update draws", () => {
    const html = page(view({ error: failedRoundSentence(lead()) }));
    expect(html).toMatch(/<p class="[^"]*failed[^"]*"[^>]*>[\s\S]*The branch could not be removed\./);
  });
});
