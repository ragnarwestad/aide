import { describe, expect, test } from "bun:test";
import { PHASE_STEPS, WORKFLOW_STEPS, parseJobRequest, type QueueDefaults } from "../../../src/queue/queue.ts";
import { wikiTrackingKey } from "../../../src/queue/steps.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};
const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);
const parse = (specFolder: string, steps: string[]) =>
  parseJobRequest({ project: "aide", specFolder, steps }, { resolve, defaults: DEFAULTS });

describe("parseJobRequest — the wiki step", () => {
  test("wiki is a workflow step and never a phase", () => {
    expect((WORKFLOW_STEPS as readonly string[]).includes("wiki")).toBe(true);
    expect((PHASE_STEPS as readonly string[]).includes("wiki")).toBe(false);
  });

  test("the tracking key is wiki-<project>", () => {
    expect(wikiTrackingKey("aide")).toBe("wiki-aide");
  });

  test("wiki-<project> with exactly the wiki step needs no spec folder (AC-1)", () => {
    const r = parse("wiki-aide", ["wiki"]);
    expect(r.ok).toBe(true);
  });

  test("the wiki step on any other folder is refused (AC-1)", () => {
    for (const folder of ["81-queue-and-runner", "wiki", "wiki-other", "schedule-aide"]) {
      const r = parse(folder, ["wiki"]);
      expect(r.ok).toBe(false);
    }
  });

  test("the wiki key with any other step, or more steps, is refused (AC-1)", () => {
    for (const steps of [["analyze"], ["schedule"], ["wiki", "analyze"], ["analyze", "wiki"]]) {
      const r = parse("wiki-aide", steps);
      expect(r.ok).toBe(false);
    }
  });
});
