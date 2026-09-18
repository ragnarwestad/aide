import { describe, expect, test } from "bun:test";
import { parseCreateRequest, parseJobRequest, type QueueDefaults } from "../../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Sonnet" },
  modelChoices: { Sonnet: {}, Opus: {} },
};
const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue"] } : null);
const BASE = { project: "aide", specFolder: "81-queue", steps: ["analyze"] };
const parse = (extra: object, defaults = DEFAULTS) => parseJobRequest({ ...BASE, ...extra }, { resolve, defaults });

describe("a model name that differs from a listed one only in case", () => {
  test("whole-job pick is stored under the listed spelling", () => {
    const r = parse({ model: "sonnet" });
    expect(r.ok && r.job.modelChoice).toBe("Sonnet");
  });

  test("per-step pick is stored under the listed spelling", () => {
    const r = parse({ model: { analyze: "opus" } });
    expect(r.ok && r.job.model).toEqual({ analyze: "Opus" });
  });

  test("New-spec picks, running and pending, are stored under the listed spelling", () => {
    const r = parseCreateRequest(
      { project: "aide", title: "T", description: "D", steps: ["analyze"], model: { analyze: "opus", implement: "sonnet" } },
      { allow: () => true, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model?.analyze).toBe("Opus");
    expect(r.pendingStepModels).toEqual({ implement: "Sonnet" });
  });

  test("an exact entry beats a case-only one", () => {
    const defaults = { ...DEFAULTS, modelChoices: { sonnet: {}, Sonnet: {} } };
    const r = parse({ model: "sonnet" }, defaults);
    expect(r.ok && r.job.modelChoice).toBe("sonnet");
  });

  test("several case-only matches are refused, naming both", () => {
    const defaults = { ...DEFAULTS, modelChoices: { Sonnet: {}, SONNET: {} } };
    const r = parse({ model: "sonnet" }, defaults);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Sonnet");
    expect(r.error).toContain("SONNET");
  });

  test("a name that differs by more than case keeps its refusal text", () => {
    const r = parse({ model: "haiku" });
    expect(!r.ok && r.error).toContain("unknown or not-allowed model: haiku");
    expect(!r.ok && r.error).not.toContain("listed as");
  });
});
