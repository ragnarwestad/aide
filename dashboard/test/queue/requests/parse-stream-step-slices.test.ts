// A Close's, Reopen's or deploy's Log cut per step, so each step's line on
// the Running tab can unfold its own part of it.

import { describe, expect, test } from "bun:test";
import { stepSlices, type LogPart } from "../../../src/queue/parse-stream";

const PREP = "10:00:00 +0s --- Step Aide: preparing — started";
const PREP_DONE = "10:00:02 +2s --- Step Aide: preparing — done";
const ONE = "--- Step 1 of 2: Move the spec — started";
const ONE_DONE = "--- Step 1 of 2: Move the spec — done";
const TWO = "--- Step 2 of 2: Commit — started";

describe("stepSlices", () => {
  test("each step gets the lines from its first mark until the next step's", () => {
    const logs: LogPart[] = [
      { by: "aide-before", lines: [PREP, "pulled main", PREP_DONE] },
      { by: "ai", lines: [ONE, "moved it", ONE_DONE, TWO, "committed"] },
    ];
    const slices = stepSlices(logs);
    expect([...slices.keys()]).toEqual(["Step Aide: preparing", "Step 1 of 2", "Step 2 of 2"]);
    expect(slices.get("Step Aide: preparing")).toEqual([{ by: "aide-before", lines: [PREP, "pulled main", PREP_DONE] }]);
    expect(slices.get("Step 1 of 2")).toEqual([{ by: "ai", lines: [ONE, "moved it", ONE_DONE] }]);
    expect(slices.get("Step 2 of 2")).toEqual([{ by: "ai", lines: [TWO, "committed"] }]);
  });

  test("what came after a step ended belongs to the next step that starts", () => {
    const slices = stepSlices([
      { by: "aide-before", lines: [PREP, PREP_DONE] },
      { by: "ai", lines: ["read the spec", ONE] },
    ]);
    expect(slices.get("Step Aide: preparing")).toEqual([{ by: "aide-before", lines: [PREP, PREP_DONE] }]);
    expect(slices.get("Step 1 of 2")).toEqual([
      { by: "ai", lines: ["read the spec"] },
      { by: "ai", lines: [ONE] },
    ]);
  });

  test("what came after the last step ended belongs to that step", () => {
    const slices = stepSlices([{ by: "ai", lines: [ONE, ONE_DONE, "all done"] }]);
    expect(slices.get("Step 1 of 2")).toEqual([
      { by: "ai", lines: [ONE, ONE_DONE] },
      { by: "ai", lines: ["all done"] },
    ]);
  });

  test("what came before any mark belongs to the first step marked", () => {
    const slices = stepSlices([{ by: "aide-before", lines: ["started the run", PREP, "pulled main"] }]);
    expect(slices.get("Step Aide: preparing")).toEqual([
      { by: "aide-before", lines: ["started the run"] },
      { by: "aide-before", lines: [PREP, "pulled main"] },
    ]);
  });

  test("a subagent's work stays whole, with the step it ran in", () => {
    const helper: LogPart = { by: "subagent", name: "reviewer", lines: ["read the diff"] };
    const slices = stepSlices([{ by: "ai", lines: [ONE] }, helper, { by: "ai", lines: [TWO] }]);
    expect(slices.get("Step 1 of 2")).toEqual([{ by: "ai", lines: [ONE] }, helper]);
  });

  test("a log with no marks has no slices", () => {
    expect(stepSlices([{ by: "ai", lines: ["did things"] }]).size).toBe(0);
  });
});
