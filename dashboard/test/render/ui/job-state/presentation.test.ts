import { expect, test } from "bun:test";
import { jobPresentation } from "../../../../src/render/ui/job-state/presentation.ts";
import { wordPhase } from "../../../../src/render/ui/job-state/word-phase.ts";
import type { QueueRowView } from "../../../../src/render/ui/job-state/types.ts";
const row = (patch: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "merge", project: "p", specFolder: "land", steps: ["land"], stepIndex: 0,
  state: "running", spentUsd: 0, timeoutSec: 0, createdAt: "now", ...patch,
});
const position = { id: "merge:one", n: 2, total: 4, operation: "land", reason: "Repository busy" };
test("automatic holds queue Archive and Merge with or without positions; a held deploy is running; a usage wait is waiting (AC-3)", () => {
  for (const step of ["archive", "land"]) for (const queuePosition of [undefined, { ...position, operation: step }]) {
    const got = jobPresentation(row({ steps: [step], queuePosition,
      errorReason: "held-back", error: { key: "runner.landingPause" } }));
    expect(got).toMatchObject({ state: "queued", variant: "waiting" });
    expect(got.waiting).toEqual(queuePosition);
  }
  expect(jobPresentation(row({ steps: ["deploy"], errorReason: "held-back", error: { key: "runner.landingPause" } })).state).toBe("running");
  expect(jobPresentation(row({ steps: ["deploy"], state: "queued", errorReason: "held-back", error: { key: "runner.landingPause" } })).state).toBe("queued");
  expect(jobPresentation(row({ state: "waiting", stopReason: "provider-limit", usageLimitWait: { until: "2027-01-01T00:00:00Z", resetKnown: true } })).state).toBe("waiting");
});
test("person-dependent holds and declined steps override numbered membership (AC-4)", () => {
  expect(jobPresentation(row({ state: "queued", queuePosition: position, errorReason: "held-back", error: "Choose an approach" })).state).toBe("needs-action");
  for (const terminalReason of ["acceptance-criteria-unticked", "approach-choice"]) {
    expect(jobPresentation(row({ state: "done", queuePosition: position, results: [{ step: "archive", ok: true, costUsd: 0, terminalReason }] })).state).toBe("needs-action");
  }
});
test("only active merge task two means Testing; waits and settlement win (AC-5)", () => {
  expect(jobPresentation(row({ mergeActivity: "testing" })).state).toBe("testing");
  expect(jobPresentation(row({ mergeActivity: "testing", queuePosition: position })).state).toBe("queued");
  expect(jobPresentation(row({ state: "failed", mergeActivity: "testing", queuePosition: position })).state).toBe("failed");
  expect(jobPresentation(row({ state: "done", mergeActivity: "testing" })).state).toBe("done");
});
test("merge activity is current and unknown marks retain Running (AC-6)", () => {
  expect(jobPresentation(row({ mergeActivity: "merging" })).state).toBe("merging");
  expect(jobPresentation(row({ mergeActivity: "merging", queuePosition: position })).state).toBe("queued");
  expect(jobPresentation(row()).state).toBe("running");
  expect(jobPresentation(row({ mergeActivity: "running" })).state).toBe("running");
});

test("phase adapters forward the shared wait and warning decisions (AC-7)", () => {
  for (const error of [{ key: "runner.landingPause" as const }, "Choose an approach"]) {
    const own = row({ state: "queued", errorReason: "held-back", error, queuePosition: position });
    const shown = jobPresentation(own);
    const phase = wordPhase(false, undefined, own, { step: "land" });
    expect(phase.waiting).toEqual(shown.waiting);
    expect(phase.badge?.variant).toBe(shown.variant);
  }
});
test("a phase keeps a known position even without an editor identity (AC-3)", () => {
  const own = row({ state: "queued", queuePosition: { n: 2, total: 4, operation: "land" } });
  expect(wordPhase(false, undefined, own, { step: "land" }).badge?.label).toBe("Queued 2/4");
});

test("a next-step queue position cannot queue the phase currently merging (AC-7)", () => {
  const own = row({ steps: ["analyze", "implement"], state: "queued", stepIndex: 1, landing: true,
    queuePosition: { id: "job:next", n: 1, total: 1, operation: "implement" } });
  expect(jobPresentation(own).state).toBe("running");
  expect(jobPresentation(own).queued).toBe(false);
  expect(wordPhase(true, undefined, own, { step: "analyze" }).badge?.label).toBe("Running");
  expect(wordPhase(false, undefined, own, { step: "implement" }).badge?.label).toBe("Queued 1/1");
});
