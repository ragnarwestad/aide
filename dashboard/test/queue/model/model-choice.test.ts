import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeQueueDefaults,
  parseJobRequest,
  type QueueDefaults,
} from "../../../src/queue/queue.ts";

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

const REQ = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));


// Reserving the heaviest model for the heaviest jobs (per-job model
// choice). Two rules do the work here:
//   * the CONFIG lists which models may be picked, so a request can
//     never invent one
//   * the budget follows the model FROM THE CONFIG, so picking a
//     hungrier model grants the headroom it needs without a request
//     ever setting a number itself
describe("per-job model choice", () => {
  const WITH_CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: {
      sonnet: { budgetUsd: 3 },
      opus: { budgetUsd: 3 },
      fable: { budgetUsd: 12, jobCapUsd: 30 },
    },
  };

  test("a listed model runs every step, with that model's budget", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: "fable" },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "fable", implement: "fable" });
    expect(r.job.modelChoice).toBe("fable");
    expect(r.job.budgetUsd).toBe(12);
    expect(r.job.jobCapUsd).toBe(30);
  });

  test("a model without its own job cap keeps the configured one", () => {
    const r = parseJobRequest({ ...REQ, model: "opus" }, { resolve, defaults: WITH_CHOICES });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.budgetUsd).toBe(3);
    expect(r.job.jobCapUsd).toBe(DEFAULTS.jobCapUsd);
  });

  test("an unlisted model is refused — a request cannot invent one", () => {
    const r = parseJobRequest({ ...REQ, model: "gpt-9" }, { resolve, defaults: WITH_CHOICES });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("gpt-9");
  });

  test("with no choices configured, naming a model is refused rather than ignored", () => {
    const r = parseJobRequest({ ...REQ, model: "fable" }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("model");
  });

  test("no model named → the per-step config still decides, unchanged", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"] },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "opus" });
    expect(r.job.modelChoice).toBeUndefined();
    expect(r.job.budgetUsd).toBe(DEFAULTS.budgetUsd);
  });

  test("the request still cannot raise the budget past what the model was granted", () => {
    const raised = parseJobRequest(
      { ...REQ, model: "fable", budgetUsd: 40 },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(raised.ok).toBe(false);

    const tightened = parseJobRequest(
      { ...REQ, model: "fable", budgetUsd: 5 },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(tightened.ok).toBe(true);
    if (!tightened.ok) return;
    expect(tightened.job.budgetUsd).toBe(5);
  });

  test("mergeQueueDefaults reads the choices, and drops malformed ones", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      modelChoices: {
        fable: { budgetUsd: 40, jobCapUsd: 90 },
        sonnet: { budgetUsd: 15 },
        broken: { budgetUsd: "lots" },
        alsoBroken: 7,
      },
    });
    expect(merged.modelChoices).toEqual({
      fable: { budgetUsd: 40, jobCapUsd: 90 },
      sonnet: { budgetUsd: 15 },
    });
  });

  test("a config with no choices leaves the field absent", () => {
    expect(mergeQueueDefaults(DEFAULTS, { budgetUsd: 15 }).modelChoices).toBeUndefined();
  });
});

// Spec 125: a pickable choice may name a TOOL as well as a budget, and
// a model name of its own distinct from the entry's key. Both fields are
// optional, and both defaults reproduce exactly what a config without
// them already did — an existing queue-config.json must keep working
// untouched.
describe("a model choice may name its tool", () => {
  test("mergeQueueDefaults keeps tool and model, and still drops malformed entries", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      modelChoices: {
        "codex-fast": { budgetUsd: 5, tool: "codex", model: "gpt-5.6" },
        sonnet: { budgetUsd: 3 },
        wrongTool: { budgetUsd: 3, tool: "gemini" },
        brokenModel: { budgetUsd: 3, tool: "codex", model: 7 },
      },
    });
    expect(merged.modelChoices).toEqual({
      "codex-fast": { budgetUsd: 5, tool: "codex", model: "gpt-5.6" },
      sonnet: { budgetUsd: 3 },
      // A tool nobody can run is dropped from the entry, not made up:
      // the budget still stands, and the run falls to claude.
      wrongTool: { budgetUsd: 3 },
      brokenModel: { budgetUsd: 3, tool: "codex" },
    });
  });

  test("a codex choice grants its budget the same way any other does", () => {
    const withCodex: QueueDefaults = {
      ...DEFAULTS,
      modelChoices: { "codex-fast": { budgetUsd: 9, tool: "codex", model: "gpt-5.6" } },
    };
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], model: "codex-fast" },
      { resolve, defaults: withCodex },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The NAME is what is stored and posted, exactly as before — the
    // real `--model` value is resolved where the argv is built.
    expect(r.job.model).toEqual({ analyze: "codex-fast" });
    expect(r.job.budgetUsd).toBe(9);
  });
});
