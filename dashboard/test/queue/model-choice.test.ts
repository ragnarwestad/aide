import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QueueStore,
  mergeQueueDefaults,
  parseJobRequest,
  type QueueDefaults,
} from "../../src/queue/queue.ts";
import { resolveStepModel } from "../../src/serve/serve.ts";

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

// Spec 123: the model is chosen ON THE PHASE LINE, so one Run press can
// carry a DIFFERENT model for each phase it ticks. The whole-job string
// above is kept working unchanged; this is the shape the per-phase
// dropdowns post. Two rules carry over from the whole-job path and one
// is new:
//   * every NAME is still looked up in the config, so a request can
//     never invent a model — checked once per entry now
//   * a step named here must be one this job is actually running
//   * the budget is the LARGEST any one chosen model was granted, never
//     the sum: `queue.ts`'s own rule is that a request may only TIGHTEN
//     a cap, and two picks together may not buy more headroom than the
//     more generous of them already had.
describe("per-step model choice", () => {
  const WITH_CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: {
      sonnet: { budgetUsd: 3 },
      opus: { budgetUsd: 3 },
      fable: { budgetUsd: 12, jobCapUsd: 30 },
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

  test("the budget is the MAX across the chosen models, never their sum", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "sonnet", implement: "fable" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // sonnet grants 3, fable grants 12 — the job gets 12, not 15.
    expect(r.job.budgetUsd).toBe(12);
    // Same rule for the job cap: fable's 30, not 30 + sonnet's.
    expect(r.job.jobCapUsd).toBe(30);
  });

  test("a map naming only cheap models buys no more headroom than they were granted", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "sonnet", implement: "opus" } },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.budgetUsd).toBe(3);
    // Neither names a job cap of its own, so the configured one stands.
    expect(r.job.jobCapUsd).toBe(DEFAULTS.jobCapUsd);
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
    // And the skipped step's grant buys no headroom: fable's jobCapUsd
    // must not leak into a job that will never run it.
    expect(r.job.jobCapUsd).toBe(DEFAULTS.jobCapUsd);
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

  test("the request still cannot raise the budget past what the map was granted", () => {
    const raised = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "sonnet", implement: "fable" }, budgetUsd: 40 },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(raised.ok).toBe(false);

    const tightened = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], model: { analyze: "sonnet", implement: "fable" }, budgetUsd: 5 },
      { resolve, defaults: WITH_CHOICES },
    );
    expect(tightened.ok).toBe(true);
    if (!tightened.ok) return;
    expect(tightened.job.budgetUsd).toBe(5);
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
    expect(r.job.budgetUsd).toBe(12);
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
    expect(r.job.budgetUsd).toBe(DEFAULTS.budgetUsd);
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
    expect(r.job.budgetUsd).toBe(DEFAULTS.budgetUsd);
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
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
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

  // The page drew implement as a live select; by the time the pick
  // arrived the runner had walked onto it. The store decides against
  // the job as it is at that instant, never against what the page
  // believed.
  test("a step the runner has walked past since the page drew it is refused by name (criterion 6)", () => {
    const job = running(["analyze", "implement"]);
    job.store.update(job.id, { stepIndex: 1 });
    const answer = job.store.editTailModel(job.id, "implement", "fable");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toContain("implement");
    expect(job.model().implement).toBe("opus");
  });

  test("a model the server does not offer is refused, in the words job creation uses (criterion 7)", () => {
    const job = running(["analyze", "implement"]);
    const answer = job.store.editTailModel(job.id, "implement", "haiku");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toBe("unknown or not-allowed model: haiku");
    expect(job.model().implement).toBe("opus");
  });

  test("a server with no choices configured refuses every name (criterion 7)", () => {
    const job = running(["analyze", "implement"], 0, DEFAULTS);
    const answer = job.store.editTailModel(job.id, "implement", "fable");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toBe("no model choice is configured on this server");
  });

  test("a malformed name is refused before the table is asked", () => {
    const job = running(["analyze", "implement"]);
    const answer = job.store.editTailModel(job.id, "implement", "fable/../etc");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toBe("invalid model");
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

  // The caps are the config's to grant, and this route grants none: a
  // job created on a modest model does not buy a hungrier one's
  // headroom by being re-pointed at it mid-run.
  test("the job's own budget is left exactly where it was", () => {
    const job = running(["analyze", "implement"]);
    const before = job.store.get(job.id)!;
    expect(job.store.editTailModel(job.id, "implement", "fable").ok).toBe(true);
    const after = job.store.get(job.id)!;
    expect(after.budgetUsd).toBe(before.budgetUsd);
    expect(after.jobCapUsd).toBe(before.jobCapUsd);
  });
});
