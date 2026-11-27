// The provider a request picks: whole-job or per step, stored on the job, and
// refused when it is not configured or cannot run the step's model.

import { describe, expect, test } from "bun:test";
import { parseCreateRequest, parseJobRequest } from "../../../src/queue/queue.ts";
import { PROVIDER_DEFAULTS as DEFAULTS } from "../queue-fixtures.ts";

const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue"] } : null);
const BASE = { project: "aide", specFolder: "81-queue", steps: ["analyze", "implement"] };
const parse = (extra: object) => parseJobRequest({ ...BASE, ...extra }, { resolve, defaults: DEFAULTS });
const create = (extra: object) =>
  parseCreateRequest(
    { project: "aide", title: "T", description: "D", steps: ["analyze"], ...extra },
    { allow: () => true, defaults: DEFAULTS },
  );

describe("a job request's provider", () => {
  test("a per-step pick is stored beside the model, for the steps the job runs (AC-9, AC-12)", () => {
    const r = parse({ model: { implement: "gpt-6" }, provider: { analyze: "Claude-Capra", implement: "Codex", archive: "Codex" } });
    expect(r.ok && r.job.provider).toEqual({ analyze: "Claude-Capra", implement: "Codex" });
  });

  test("a whole-job pick applies to every step (AC-9, AC-12)", () => {
    const r = parse({ provider: "Claude-Capra" });
    expect(r.ok && r.job.provider).toEqual({ analyze: "Claude-Capra", implement: "Claude-Capra" });
  });

  test("a request with no provider stores none, and a blank entry is skipped (AC-9, AC-12)", () => {
    const none = parse({});
    expect(none.ok && none.job.provider).toBeUndefined();
    const blank = parse({ provider: { analyze: "" } });
    expect(blank.ok && blank.job.provider).toBeUndefined();
  });

  test("a key that is not configured is refused (AC-9, AC-12)", () => {
    const r = parse({ provider: { analyze: "Gone" } });
    expect(!r.ok && r.error).toContain("unknown or not-allowed provider: Gone");
    expect(!r.ok && r.solution).toBe("Reload the page and try again");
  });

  test("a model the provider cannot run is refused, naming both tools (AC-9, AC-12)", () => {
    const r = parse({ model: { analyze: "gpt-6" }, provider: { analyze: "Claude-Capra" } });
    expect(!r.ok && r.error).toContain("gpt-6 is a Codex model and Claude-Capra is a Claude Code provider — pick a model under it");
  });
});

describe("a create request's provider", () => {
  test("the running step's provider is stored and a later phase's is banked as pending (AC-9)", () => {
    const r = create({ model: { implement: "gpt-6" }, provider: { analyze: "Claude-Capra", implement: "Codex" } });
    expect(r.ok && r.job.provider).toEqual({ analyze: "Claude-Capra" });
    expect(r.pendingStepProviders).toEqual({ implement: "Codex" });
  });

  test("a pending provider that cannot run the pending model is refused (AC-9)", () => {
    const r = create({ model: { implement: "gpt-6" }, provider: { implement: "Claude" } });
    expect(!r.ok && r.error).toContain("gpt-6 is a Codex model and Claude is a Claude Code provider");
  });
});
