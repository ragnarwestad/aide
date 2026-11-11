import { expect, test } from "bun:test";
import { scheduleRequest } from "../../src/queue/schedule.ts";

test("timer and Run now share schedule identity and optional choices (AC-3)", () => {
  expect(scheduleRequest("aide", { name: "nightly", model: "opus", provider: "Claude" })).toEqual({
    project: "aide",
    specFolder: "schedule-nightly",
    steps: ["schedule"],
    model: "opus",
    provider: "Claude",
  });
  expect(scheduleRequest("aide", { name: "nightly" })).toEqual({
    project: "aide",
    specFolder: "schedule-nightly",
    steps: ["schedule"],
  });
});
