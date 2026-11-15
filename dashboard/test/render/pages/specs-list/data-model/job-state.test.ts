import { expect, test } from "bun:test";
import { JOB_STATES } from "../../../../../src/job-states.ts";
import { jobState, offersReopen } from "../../../../../src/render/pages/specs-list/data-model/job-state.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model/types.ts";

const group = (extra: Partial<SpecGroup> = {}) => ({ state: "archived", done: [], ...extra }) as SpecGroup;

test("Jobs reports a finished archived or closed spec's job as done", () => {
  for (const state of ["archived", "closed"] as const) {
    expect(jobState(group({ state }))).toBe("done");
  }
});

test("Reopen belongs to Specs, including a failed archived criterion", () => {
  const archived = group();
  expect(offersReopen(archived, false)).toBe(false);
  expect(offersReopen(archived, true)).toBe(true);
  expect(offersReopen(group({ archive: { notLanded: true } as SpecGroup["archive"] }), true)).toBe(false);
  expect(offersReopen(group({ lead: { state: "running" } as SpecGroup["lead"] }), true)).toBe(false);
});

test("an unfinished spec follows its latest job, not its completed phases (AC-3)", () => {
  for (const state of JOB_STATES) {
    expect(jobState(group({ state: "not-started", done: ["analyze", "implement"], lead: { state } as SpecGroup["lead"] }))).toBe(state);
  }
  expect(jobState(group({ archive: { notLanded: true, prOpen: true } as SpecGroup["archive"] }))).toBe("done");
});

test("an archive that did not land is a failed job", () => {
  expect(jobState(group({ archive: { notLanded: true } as SpecGroup["archive"] }))).toBe("failed");
});

test("a running or landing archive keeps the job's activity", () => {
  for (const [state, landing] of [["running", false], ["done", true], ["queued", true]] as const) {
    const lead = { state, landing, steps: ["archive"], stepIndex: 0 } as SpecGroup["lead"];
    expect(jobState(group({ lead, archive: { notLanded: true } as SpecGroup["archive"] }))).toBe(state);
  }
});
