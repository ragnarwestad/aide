// Split out of parsing.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PHASE_STEPS,
  WORKFLOW_STEPS,
  parseJobRequest,
} from "../../../src/queue/queue.ts";
import { RUN_STEPS } from "../../../src/render/pages/specs-list";
import { STEP_ENDINGS } from "../../../src/step-endings.ts";
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

  test("a schedule job for an unallowed project is still refused", () => {
    const r = parseJobRequest(
      { project: "not-a-project", specFolder: "schedule-nightly-report", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("project");
  });
});

// `stopReason` is the same shape of pair, and for the same reason: the
// stored union lives in `queue/steps.ts` and the row's own copy in
// `render/ui/job-state/types.ts`, which do not import each other. A
// member added to one side alone leaves `stateLabel` with no branch for
// it at all.
describe("stopReason", () => {
  const membersOf = (file: string, pattern: RegExp): string[] => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "..", "src", file), "utf-8");
    const line = src.match(pattern);
    expect(line).not.toBeNull();
    return line![1]!
      .split("|")
      .map((m) => m.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .sort();
  };

  test("names the same members on the job and on the row's view", () => {
    const stored = STEP_ENDINGS.filter(({ jobStop }) => jobStop).map(({ name }) => name).sort();
    expect(membersOf("render/ui/job-state/types.ts", /^\s*stopReason\?:([^;]*);/m)).toEqual(["string"]);
    // Named, so widening the union without a reader is caught here
    // rather than at the page: `tests-red` is the landing's own suite
    // going red on the merged result, which pushes nothing and asks for
    // implement to run again — the only one of the seven that is not the
    // run itself being cut short. `model-at-capacity` is the provider
    // having no room for the chosen model right now. `sent-back` is an
    // implement that found its short analysis too small for the spec.
    expect(stored).toEqual(["acceptance-criteria", "model-at-capacity", "provider-limit", "sent-back", "shared-files", "tests-red", "timeout"]);
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

test("request refusals never recover a solution from a sentence suffix (AC-2)", () => {
  const root = join(import.meta.dir, "..", "..", "..", "src");
  const files = [
    "format/request-fixes.ts",
    "serve/routes/queue-admin.ts",
    "serve/routes/job-actions.ts",
    "serve/routes/schedule-admin-routes.ts",
  ];
  const source = files.map((file) => readFileSync(join(root, file), "utf-8")).join("\n");
  expect(source).not.toMatch(/splitFix|endsWith\([^\n]*fix|slice\([^\n]*fix/i);
});
