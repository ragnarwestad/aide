// Split out of parsing.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PHASE_STEPS,
  WORKFLOW_STEPS,
  parseJobRequest,
  type QueueDefaults,
} from "../../src/queue/queue.ts";
import { QUEUE_STEPS } from "../../src/render/pages/queue-list.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  // Per step since spec 152: an implement is not an analyze, and one
  // number for both stopped 149 mid-sentence with its tests green.
  timeoutSec: { default: 1200, implement: 5400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// The server resolves a project NAME to its real spec folders; the
// request never carries a path. Two allowlisted projects here.
const resolve = (project: string) =>
  project === "aide"
    ? { specFolders: ["81-queue-and-runner"] }
    : project === "aide-dashboard"
      ? { specFolders: ["01-first"] }
      : null;

// Spec 160: the steps a running job's tail may be given are exactly the
// ones a spec's row draws a box for. Two lists, in two layers that do
// not import each other — the render side knows nothing of the queue's
// module, deliberately — so this is what says they agree.
describe("PHASE_STEPS", () => {
  test("is the row's own box list, in the workflow's order", () => {
    expect([...PHASE_STEPS] as string[]).toEqual([...QUEUE_STEPS]);
    const ranks = PHASE_STEPS.map((s) => WORKFLOW_STEPS.indexOf(s));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).not.toContain(-1);
  });
});

// Spec 259: a project's own recurring job, queued through the same
// store as every other step. Queueable like `explore`/`manifest`/
// `reopen`/`reset`, but never a phase a spec passes through.
describe("WORKFLOW_STEPS — schedule (spec 259)", () => {
  test("is a workflow step but not a phase", () => {
    expect((WORKFLOW_STEPS as readonly string[]).includes("schedule")).toBe(true);
    expect((PHASE_STEPS as readonly string[]).includes("schedule")).toBe(false);
  });
});

describe("parseJobRequest — the schedule step (spec 259)", () => {
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

  test("a schedule job for an unallowed project is still refused", () => {
    const r = parseJobRequest(
      { project: "not-a-project", specFolder: "schedule-nightly-report", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("project");
  });
});

// Spec 193, criterion 11. `errorReason` is declared twice — once on the
// stored job and once on the view the render layer builds — for the
// same reason `PHASE_STEPS` is: the two layers do not import each
// other. A union widened in one place only is a reason the row cannot
// draw, and TypeScript says nothing about it because the render side
// takes its own narrower type. The declarations are read as TEXT
// because neither side has a runtime value to compare, which is the
// same thing `test_aide_run_spec.py` does to the bash and TypeScript
// copies of `WORKFLOW_STEPS`.
describe("errorReason", () => {
  /** The members of the `errorReason?: ...` union in one source file. */
  const declaredIn = (file: string): string[] => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src", file), "utf-8");
    const line = src.match(/^\s*errorReason\?:([^;]*);/m);
    expect(line).not.toBeNull();
    return line![1]!
      .split("|")
      .map((m) => m.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .sort();
  };

  test("names the same members on the job and on the row's view", () => {
    const stored = declaredIn("queue/types.ts");
    expect(stored).toEqual(declaredIn("render/ui/job-state/types.ts"));
    // Named, so widening the union without a reader is caught here
    // rather than at the page: `unlanded` is spec 193's refusal — the
    // spec was archived and a branch of its own is still on origin.
    expect(stored).toEqual(["conflict", "tests-red", "unlanded"]);
  });
});

// The widened validation is for ONE route. `parseJobRequest` still
// requires a project with a discovered spec — a regression guard, green
// today and green afterwards.
test("an ordinary job request still needs a project with a discovered spec", () => {
  const r = parseJobRequest(
    { project: "brandnew", specFolder: "01-first", steps: ["analyze"] },
    { resolve, defaults: DEFAULTS },
  );
  expect(r.ok).toBe(false);
});
