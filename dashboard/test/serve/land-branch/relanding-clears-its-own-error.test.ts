// The other half of the rule. A landing failure is the record of
// the step it names, and that step's own successful landing resolves it:
// A row once said "could not assign this spec its number —
// nothing was pushed; run the step again" while the number had been
// assigned and pushed since (2026-09-20). A LATER step's success still
// leaves the record alone.

import { describe, expect, test } from "bun:test";
import { landAnalyzeWhile } from "./landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "479-spec" };

const failedAt = (step: string) => ({
  landingError: { key: "landing.stepFailed", values: { step }, inner: { key: "landing.createAssignNumberFailed" } },
  landingErrorDetail: "aide-create-spec: no readable answer",
});

/** The landing's own success patch: the one that names the branch. */
const landAnalyze = (current: Record<string, unknown>) => landAnalyzeWhile(JOB, current, "aide-relanding-");

describe("a landing that succeeds", () => {
  test("clears the failure recorded for its own step, detail and all", async () => {
    const landed = await landAnalyze(failedAt("analyze"));
    expect("landingError" in landed).toBe(true);
    expect(landed.landingError).toBeUndefined();
    expect(landed.landingErrorDetail).toBeUndefined();
  });

  test("has nothing to clear when no landing failed", async () => {
    const landed = await landAnalyze({});
    expect("landingError" in landed).toBe(false);
  });
});
