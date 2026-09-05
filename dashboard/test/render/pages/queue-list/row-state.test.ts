// REQ-3, spec 399: `busyReason()`'s tooltip names the step whose merge
// is actually in progress, in the same word the row's own badge shows
// for it — not whichever step `currentStep()` happens to read.

import { describe, expect, test } from "bun:test";
import { busyReason } from "../../../../src/render/pages/queue-list/row-state.ts";
import type { SpecGroup } from "../../../../src/render/pages/queue-list/data-model.ts";
import { row } from "../fixtures.ts";

const group = (lead: SpecGroup["lead"]): SpecGroup => ({
  project: "aide",
  specFolder: "81-x",
  named: true,
  state: lead?.state ?? "done",
  spentUsd: 0,
  costUnmeasured: false,
  phases: [],
  done: [],
  dependsOn: [],
  analyzeStale: false,
  lead,
});

describe("busyReason names the step actually merging (REQ-3, spec 399)", () => {
  test("a job done on its last step: names that step's own merge", () => {
    const g = group(row({ steps: ["create"], stepIndex: 0, state: "done", landing: true }));
    expect(busyReason(g)).toBe("create is creating");
  });

  // resting.ts:74-79's documented case: the job has already advanced to
  // "queued" on its NEXT step while the PREVIOUS one is still merging.
  // The step actually landing is `steps[stepIndex - 1]` ("create"), not
  // `steps[stepIndex]` ("analyze") — the same rule the row's own badge
  // (`specStateChip`) already applies via `landingStep`.
  test("a job already queued on its next step: names the step whose merge is actually in progress, not the queued one", () => {
    const g = group(row({ steps: ["create", "analyze"], stepIndex: 1, state: "queued", landing: true }));
    expect(busyReason(g)).toBe("create is creating");
    expect(busyReason(g)).not.toContain("analyze");
  });

  test("no landing: falls back to the current step and its state label, unchanged", () => {
    const g = group(row({ steps: ["analyze"], stepIndex: 0, state: "running" }));
    expect(busyReason(g)).toContain("analyze");
  });

  test("no lead job: empty string", () => {
    expect(busyReason(group(undefined))).toBe("");
  });
});
