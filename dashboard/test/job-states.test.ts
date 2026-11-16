import { expect, test } from "bun:test";
import { ERROR_REASONS, JOB_STATES, isErrorReason, isJobState } from "../src/job-states.ts";
import { JOB_STATES as QUEUE_JOB_STATES } from "../src/queue/queue.ts";

test("the shared job-state catalogue accepts its members and rejects unknown values (AC-1, AC-4, AC-8)", () => {
  for (const state of JOB_STATES) expect(isJobState(state)).toBe(true);
  for (const value of ["awaiting-approval", "Queued", "", undefined, 1]) {
    expect(isJobState(value)).toBe(false);
  }
  expect(QUEUE_JOB_STATES).toBe(JOB_STATES);
});

test("the shared error-reason catalogue preserves its four members and rejects unknown values (AC-2, AC-5, AC-7, AC-8)", () => {
  expect(ERROR_REASONS).toEqual(["conflict", "held-back", "tests-red", "unlanded"]);
  for (const reason of ERROR_REASONS) expect(isErrorReason(reason)).toBe(true);
  for (const value of ["bogus", "Conflict", "", undefined, 1]) {
    expect(isErrorReason(value)).toBe(false);
  }
});
