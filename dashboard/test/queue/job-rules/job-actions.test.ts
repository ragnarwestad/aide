// The table of what a job's row on Jobs offers: its one button and its
// menu, per kind and state.

import { describe, expect, test } from "bun:test";
import { jobActions, offers, type JobAction, type JobActionRow, type JobActions } from "../../../src/queue/job-rules/job-actions.ts";

const row = (step: string, o: Partial<JobActionRow> = {}): JobActionRow => ({ state: "queued", steps: [step], stepIndex: 0, ...o });
const NONE = { menu: [] };
const BUTTON = (button: JobAction): JobActions => ({ button, menu: [] });

describe("a scheduled job", () => {
  test("offers Cancel while queued, running, landing or waiting on its usage limit", () => {
    expect(jobActions(row("schedule"))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("schedule", { state: "running" }))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("schedule", { state: "done", landing: true }))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("schedule", { state: "waiting", usageLimitWait: { until: "2027-01-01T00:00:00Z" } }))).toEqual(BUTTON("cancel"));
  });

  test("offers Start with Remove in the menu once cancelled, and Remove alone once failed", () => {
    expect(jobActions(row("schedule", { state: "cancelled" }))).toEqual({ button: "start", menu: ["remove"] });
    expect(jobActions(row("schedule", { state: "failed" }))).toEqual(BUTTON("remove"));
  });

  test("offers nothing once done", () => {
    expect(jobActions(row("schedule", { state: "done" }))).toEqual(NONE);
  });
});

describe("a deploy", () => {
  test("offers Cancel while queued or held back, and nothing once its fetch has begun", () => {
    expect(jobActions(row("deploy"))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("deploy", { state: "running", errorReason: "held-back" }))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("deploy", { state: "running" }))).toEqual(NONE);
    expect(jobActions(row("deploy", { state: "running", errorReason: "held-back", deploy: { restartedAt: "2026-11-17T00:00:00Z" } }))).toEqual(NONE);
  });

  test("offers Remove once failed or cancelled, and nothing once done", () => {
    for (const state of ["failed", "cancelled"]) expect(jobActions(row("deploy", { state }))).toEqual(BUTTON("remove"));
    expect(jobActions(row("deploy", { state: "done" }))).toEqual(NONE);
  });
});

describe("a Merge", () => {
  test("offers Cancel until its push begins", () => {
    expect(jobActions(row("land"))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("land", { state: "running" }))).toEqual(BUTTON("cancel"));
    expect(jobActions(row("land", { state: "running", landPushStarted: true }))).toEqual(NONE);
  });

  test("failed or cancelled, offers Start with Remove in the menu", () => {
    for (const state of ["failed", "cancelled"]) expect(jobActions(row("land", { state }))).toEqual({ button: "start", menu: ["remove"] });
  });

  test("failed or cancelled with its branch gone from origin, offers Remove alone", () => {
    for (const state of ["failed", "cancelled"]) expect(jobActions(row("land", { state, branchGone: true }))).toEqual(BUTTON("remove"));
  });

  test("offers nothing once done", () => {
    expect(jobActions(row("land", { state: "done" }))).toEqual(NONE);
  });
});

test("a Close or Reopen offers nothing: a half-done move would leave the spec between two places", () => {
  for (const step of ["close", "reopen"]) {
    for (const state of ["queued", "running", "failed"]) expect(jobActions(row(step, { state }))).toEqual(NONE);
  }
});

test("a removed job offers nothing", () => {
  expect(jobActions(row("deploy", { state: "failed", removedAt: "2026-11-21T10:00:00Z" }))).toEqual(NONE);
});

test("a row never has more than one button, and offers() reads the button and the menu", () => {
  const failed = row("land", { state: "failed" });
  expect(offers(failed, "start")).toBe(true);
  expect(offers(failed, "remove")).toBe(true);
  expect(offers(failed, "cancel")).toBe(false);
});
