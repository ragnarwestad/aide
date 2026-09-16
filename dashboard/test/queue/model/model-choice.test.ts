import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeQueueDefaults,
  parseJobRequest,
  type QueueDefaults,
} from "../../../src/queue/queue.ts";
import { RUNNABLE_TOOLS } from "../../../src/queue/steps.ts";

const DEFAULTS: QueueDefaults = {
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


// A model may be picked for the whole job — the CONFIG lists which
// models may be picked, so a request can never invent one.
describe("per-job model choice", () => {
  const WITH_CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: {
      sonnet: {},
      opus: {},
      fable: {},
    },
  };

  test("a listed model runs every step", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: "fable" },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "fable", implement: "fable" });
    expect(r.job.modelChoice).toBe("fable");
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
  });

  test("mergeQueueDefaults reads the choices, and drops non-object entries", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      modelChoices: {
        fable: { tool: "codex" },
        sonnet: {},
        alsoBroken: 7,
      },
    });
    expect(merged.modelChoices).toEqual({
      fable: { tool: "codex" },
      sonnet: {},
    });
  });

  test("a config with no choices leaves the field absent", () => {
    expect(mergeQueueDefaults(DEFAULTS, {}).modelChoices).toBeUndefined();
  });
});

// Spec 125: a pickable choice may name a TOOL as well as a model name of
// its own distinct from the entry's key. Both fields are optional, and
// both defaults reproduce exactly what a config without them already
// did — an existing queue-config.json must keep working untouched.
describe("a model choice may name its tool", () => {
  test("mergeQueueDefaults keeps tool and model, and drops a malformed tool or model", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      modelChoices: {
        "codex-fast": { tool: "codex", model: "gpt-5.6" },
        sonnet: {},
        wrongTool: { tool: "gemini" },
        brokenModel: { tool: "codex", model: 7 },
      },
    });
    expect(merged.modelChoices).toEqual({
      "codex-fast": { tool: "codex", model: "gpt-5.6" },
      sonnet: {},
      // A tool nobody can run is dropped from the entry, not made up:
      // the entry still stands, and the run falls to claude.
      wrongTool: {},
      brokenModel: { tool: "codex" },
    });
  });

  // The bug this pins: `opencode` was a member of every TYPE in the
  // codebase and of no runtime check, so the config file's own entries
  // lost their tool and the picker offered eight OpenCode models under
  // Claude Code. A run started on one of them would have handed Claude
  // an `opencode/...` model name.
  test("every tool the runner accepts survives the config file", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      modelChoices: Object.fromEntries(
        RUNNABLE_TOOLS.map((tool) => [tool, { tool, model: `${tool}-model` }]),
      ),
    });
    for (const tool of RUNNABLE_TOOLS) {
      expect(merged.modelChoices?.[tool]).toEqual({ tool, model: `${tool}-model` });
    }
  });

  test("an OpenCode model keeps its provider prefix", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      modelChoices: { "gemini-3.1-pro": { tool: "opencode", model: "opencode/gemini-3.1-pro" } },
    });
    expect(merged.modelChoices?.["gemini-3.1-pro"]).toEqual({
      tool: "opencode",
      model: "opencode/gemini-3.1-pro",
    });
  });

  test("picking a codex choice is stored under its own name, like any other", () => {
    const withCodex: QueueDefaults = {
      ...DEFAULTS,
      modelChoices: { "codex-fast": { tool: "codex", model: "gpt-5.6" } },
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
  });
});
