// Split out of parsing.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  PHASE_STEPS,
  WORKFLOW_STEPS,
  parseJobRequest,
} from "../../../src/queue/queue.ts";
import { RUN_STEPS } from "../../../src/render/pages/specs-list";
import { DEFAULTS, resolve } from "../queue-fixtures.ts";

// The steps a running job's tail may be given are exactly the
// ones a spec's row draws a box for. Two lists, in two layers that do
// not import each other — the render side knows nothing of the queue's
// module, deliberately — so this is what says they agree.
describe("PHASE_STEPS", () => {
  test("is the row's own box list, in the workflow's order", () => {
    expect([...PHASE_STEPS] as string[]).toEqual([...RUN_STEPS]);
    const ranks = PHASE_STEPS.map((s) => WORKFLOW_STEPS.indexOf(s));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).not.toContain(-1);
  });
});

// A project's own recurring job, queued through the same
// store as every other step. Queueable like `explore`/
// `reopen`/`reset`, but never a phase a spec passes through.
describe("WORKFLOW_STEPS — schedule", () => {
  test("is a workflow step but not a phase", () => {
    expect((WORKFLOW_STEPS as readonly string[]).includes("schedule")).toBe(true);
    expect((PHASE_STEPS as readonly string[]).includes("schedule")).toBe(false);
  });
});

describe("parseJobRequest — the schedule step", () => {
  test("a schedule-<name> tracking key needs no existing spec folder", () => {
    const r = parseJobRequest(
      { project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.specFolder).toBe("schedule-nightly-report");
    expect(r.job.steps).toEqual(["schedule"]);
  });

  test("a tracking key that does not start with schedule- is refused", () => {
    const r = parseJobRequest(
      { project: "aide", specFolder: "not-a-schedule-key", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("specFolder");
  });

  test("the exemption never widens another step: schedule combined with analyze still needs a real folder", () => {
    const r = parseJobRequest(
      { project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule", "analyze"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unknown specFolder");
  });
});
