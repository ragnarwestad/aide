import { expect, test } from "bun:test";
import { groupStartPlan } from "../../../src/queue/execution-groups/phase-plan.ts";

test("manual phase choices can restart an implemented member and skip another", () => {
  expect(groupStartPlan([
    { specFolder: "1-first", done: ["analyze", "implement"] },
    { specFolder: "2-next", done: [] },
  ], {}, { "1-first": ["analyze"], "2-next": [] })).toEqual({ "1-first": ["analyze"], "2-next": [] });
});

test("old pending choices never repeat completed work on an untouched member", () => {
  expect(groupStartPlan([
    { specFolder: "1-first", done: ["analyze", "implement"] },
    { specFolder: "2-next", done: ["analyze"] },
  ], { "1-first": ["analyze", "implement"], "2-next": ["implement"] }, {}))
    .toEqual({ "1-first": [], "2-next": ["implement"] });
});
