// A model chosen for one step rather than the whole job, and editing
// that choice while the job is running.
//
// Split out of model-choice.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QueueStore,
  parseJobRequest,
  type QueueDefaults,
} from "../../../src/queue/queue.ts";
import { resolveStepModel } from "../../../src/serve/serve.ts";
import { stepTool } from "../../../src/serve/serve-helpers/runner-argv.ts";

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


// Spec 123: the model is chosen ON THE PHASE LINE, so one Run press can
// carry a DIFFERENT model for each phase it ticks. The whole-job string
// above is kept working unchanged; this is the shape the per-phase
// dropdowns post. Two rules apply:
//   * every NAME is still looked up in the config, so a request can
//     never invent a model — checked once per entry now
//   * a step named here must be one this job is actually running
describe("per-step model choice", () => {
  const WITH_CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: {
      sonnet: {},
      opus: {},
      fable: {},
    },
  };

  test("a per-step map runs each named step on its own model", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "sonnet", implement: "fable" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "fable" });
    // No single name applies to the job any more, so the field that
    // means "one pick for the whole job" is left unset.
    expect(r.job.modelChoice).toBeUndefined();
  });

  // Skipped, not refused (2026-08-19): the phase lines' selects are
  // always pre-filled, so every Run posts a name for all four steps —
  // only the ticked ones may apply.
  test("a step outside this job's own steps is skipped, and the job runs", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], model: { analyze: "sonnet", implement: "fable" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "sonnet" });
  });

  test("an unlisted model in the map is refused, exactly as a whole-job one is", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], model: { analyze: "gpt-9" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("gpt-9");
  });

  test("with no choices configured, a per-step map is refused rather than ignored", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], model: { analyze: "fable" } },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("model");
  });

  test("a step left on 'default' falls back to the config, without refusing the rest", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "fable", implement: "" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // `implement`'s own config default is opus (DEFAULTS.model).
    expect(r.job.model).toEqual({ analyze: "fable", implement: "opus" });
  });

  test("a step this job runs but the map does not name keeps the config's own choice", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "fable" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "fable", implement: "opus" });
  });

  test("a list is not a map — it is refused rather than half-read", () => {
    const r = parseJobRequest(
      { ...REQ, model: ["fable"] },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(false);
  });

  // The whole-job string is the shape every API caller written before
  // this spec still posts. It must behave byte for byte as it did.
  test("a legacy single-string model still applies to every step, unchanged", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: "fable" },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "fable", implement: "fable" });
    expect(r.job.modelChoice).toBe("fable");
  });

  // An empty string has always meant "use the configuration" rather
  // than "refuse this request" — the no-JS form posts one whenever the
  // reader leaves the field alone. A per-step branch that swallows it
  // turns a 200 into a 400 with nothing on the page to say why.
  test("an empty whole-job model is still 'use the configuration', not an error", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: "" },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "opus" });
  });

  test("an empty map is 'use the configuration' too", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: {} },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "opus" });
    expect(r.job.modelChoice).toBeUndefined();
  });
});
// --- spec 225: the model a phase still ahead will run on ----------------------

// Spec 160 let a reader add or drop a step on a running job. The AI and
// model selects beside those boxes stayed locked, and this is the store
// half of unlocking them: one method, guarded by the same `tailEdits()`
// the box already asks, so the two controls cannot disagree about which
// phases are still open.
describe("editing a running job's model for a step still ahead (spec 225)", () => {
  const CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: { sonnet: {}, fable: {} },
  };

  let made_ = 0;
  const running = (steps: string[], stepIndex = 0, defaults: QueueDefaults = CHOICES) => {
    const mirror = join(dir, `queue-model-${(made_ += 1)}.json`);
    const store = new QueueStore({ defaults, resolve, mirrorPath: mirror });
    const made = store.enqueue({ ...REQ, steps });
    if (!made.ok) throw new Error(made.error);
    store.update(made.job.id, { state: "running", stepIndex });
    return { store, mirror, id: made.job.id, model: () => store.get(made.job.id)!.model };
  };

  test("a step still ahead takes the new model, and the runner would read it (criterion 4)", () => {
    const job = running(["analyze", "implement"]);
    const answer = job.store.editTailModel(job.id, "implement", "fable");
    expect(answer.ok).toBe(true);
    expect(job.model().implement).toBe("fable");
    // The read side, unchanged by this spec and asked here on purpose:
    // what the runner spawns with is `resolveStepModel` against the job
    // as the store holds it at that instant.
    expect(resolveStepModel(job.store.get(job.id)!, "implement", DEFAULTS.model)).toBe("fable");
  });

  // The other half of `tailEdits()`: a phase this job does not have at
  // all. Writing it is inert until the step is added through the box's
  // own route, and read by the same `resolveStepModel` when it is.
  test("a differently-cased name is stored under the listed spelling (spec 494)", () => {
    const defaults = { ...DEFAULTS, modelChoices: { Sonnet: {}, Fable: {} } };
    const job = running(["analyze", "implement"], 0, defaults);
    expect(job.store.editTailModel(job.id, "implement", "fable").ok).toBe(true);
    expect(job.model().implement).toBe("Fable");
  });

  test("a phase the job does not have takes one too (criterion 4)", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailModel(job.id, "archive", "fable").ok).toBe(true);
    expect(job.model().archive).toBe("fable");
    expect(job.store.get(job.id)!.steps).toEqual(["analyze"]);
  });

  test("the running step and everything behind it are closed (criterion 3)", () => {
    const job = running(["analyze", "implement"], 1);
    for (const step of ["analyze", "implement"]) {
      const answer = job.store.editTailModel(job.id, step, "fable");
      expect(`${step}: ${answer.ok}`).toBe(`${step}: false`);
      if (!answer.ok) expect(answer.error).toContain(step);
    }
    expect(job.model().implement).toBe("opus");
  });

  test("a model the server does not offer is refused, in the words job creation uses (criterion 7)", () => {
    const job = running(["analyze", "implement"]);
    const answer = job.store.editTailModel(job.id, "implement", "haiku");
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.error).toBe(
        "unknown or not-allowed model: haiku — Reload the page and try again — " +
          "or, if this came from a raw request, check the field this names.",
      );
    }
    expect(job.model().implement).toBe("opus");
  });

  test("a server with no choices configured refuses every name (criterion 7)", () => {
    const job = running(["analyze", "implement"], 0, DEFAULTS);
    const answer = job.store.editTailModel(job.id, "implement", "fable");
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.error).toBe(
        "no model choice is configured on this server — Reload the page and try again — " +
          "or, if this came from a raw request, check the field this names.",
      );
    }
  });

  test("a malformed name is refused before the table is asked", () => {
    const job = running(["analyze", "implement"]);
    const answer = job.store.editTailModel(job.id, "implement", "fable/../etc");
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.error).toBe(
        "invalid model — Reload the page and try again — or, if this came from a raw request, check the field this names.",
      );
    }
  });

  test("a job that is not running is closed altogether (criterion 8)", () => {
    for (const state of ["queued", "done", "failed", "cancelled", "stopped", "interrupted"] as const) {
      const job = running(["analyze", "implement"]);
      job.store.update(job.id, { state });
      const answer = job.store.editTailModel(job.id, "implement", "fable");
      expect(`${state}: ${answer.ok}`).toBe(`${state}: false`);
      expect(job.model().implement).toBe("opus");
    }
  });

  test("an unknown job is not found", () => {
    running(["analyze", "implement"]);
    const job = running(["analyze", "implement"]);
    expect(job.store.editTailModel("no-such-job", "implement", "fable").ok).toBe(false);
  });

  // The mirror is what survives a restart, and a model chosen only in
  // memory would be undone by one.
  test("the edit reaches the mirror", () => {
    const job = running(["analyze", "implement"]);
    expect(job.store.editTailModel(job.id, "implement", "fable").ok).toBe(true);
    const stored = JSON.parse(readFileSync(job.mirror, "utf-8")) as {
      id: string;
      model: Record<string, string>;
    }[];
    expect(stored.find((j) => j.id === job.id)!.model.implement).toBe("fable");
  });
});

// Which CLI a waiting step will run on is what the check before a job
// starts asks about, so it follows the same choice the argv does.
describe("stepTool", () => {
  const job = (model: Record<string, string> = {}) => ({ model } as never);
  const choices = { Sonnet: {}, "gpt-6": { tool: "codex" as const } };

  test("the step's chosen model names its tool", () => {
    expect(stepTool(job({ implement: "gpt-6" }), "implement", { modelChoices: choices })).toBe("codex");
  });

  test("a choice that names no tool is claude", () => {
    expect(stepTool(job({ implement: "Sonnet" }), "implement", { modelChoices: choices })).toBe("claude");
  });

  test("the configured default applies when the job chose nothing", () => {
    expect(stepTool(job(), "analyze", { model: { default: "gpt-6" }, modelChoices: choices })).toBe("codex");
  });
});
