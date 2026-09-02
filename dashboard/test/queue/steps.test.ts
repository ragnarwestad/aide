import { describe, expect, test } from "bun:test";
import { WORKFLOW_STEPS } from "../../src/queue/steps.ts";
import workflowStepsData from "../../../core/scripts/lib/workflow-steps.json" with { type: "json" };

// Spec 349, REQ-4b: `WorkflowStep` is a hand-typed literal union (a JSON
// import types its array as `string[]`, never a literal union), so it is
// the one place this refactor keeps a type-level copy alongside the
// shared file. This test is the value-comparison half of REQ-4's "a test
// SHALL fail if either side names a step the file does not" — it fails
// the moment `steps.ts`'s own KNOWN_STEPS list disagrees with
// workflow-steps.json's `workflowSteps`.
describe("spec 349: steps.ts stays in step with workflow-steps.json", () => {
  test("WORKFLOW_STEPS matches workflow-steps.json's workflowSteps", () => {
    expect(WORKFLOW_STEPS as readonly string[]).toEqual(workflowStepsData.workflowSteps);
  });
});
