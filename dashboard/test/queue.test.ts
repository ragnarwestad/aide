// Criterion 5 (spec 81): the queue store — a job is validated against
// the discovered, allowlisted projects and their real spec folders;
// unknown fields are ignored; per-job overrides may only tighten the
// configured caps, never loosen them; the mirror survives a restart.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOB_STATES, PHASE_STEPS, QueueStore, mergeQueueDefaults, parseCreateRequest, parseJobRequest,
  persistQueueProjects, tailEdits, WORKFLOW_STEPS, type QueueDefaults,
} from "../src/queue.ts";
// The list of boxes the row DRAWS, read from the render side itself:
// the two are hand-paired, the way `WORKFLOW_STEPS` is paired with the
// bash copy in `aide-run-spec`, and a test that reads both is what
// keeps them from drifting.
import { QUEUE_STEPS } from "../src/render/queue-list.ts";
import { parseArgs } from "../src/serve.ts";

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
let mirrorPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
  mirrorPath = join(dir, "queue.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parseJobRequest", () => {
  test("a valid request becomes a job with the configured defaults", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.project).toBe("aide");
    expect(r.job.specFolder).toBe("81-queue-and-runner");
    expect(r.job.steps).toEqual(["analyze", "implement"]);
    expect(r.job.state).toBe("queued");
    expect(r.job.budgetUsd).toBe(3);
    expect(r.job.jobCapUsd).toBe(10);
    expect(r.job.timeoutSec).toEqual({ analyze: 1200, implement: 5400 });
    expect(r.job.spentUsd).toBe(0);
    expect(r.job.stepIndex).toBe(0);
  });

  // Spec 149. A gate was a stop between steps, and no form on this page
  // could ever set one — the only three jobs that ever had one were
  // posted as JSON by hand. The stop is gone, so the field is gone with
  // it: a request that still names it is not refused, it is ignored, the
  // same way every other unknown key on this route already is.
  test("gateAfter is an unknown field now — ignored, not refused, and never stored", () => {
    const named = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], gateAfter: ["analyze"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect("gateAfter" in named.job).toBe(false);
    // Not even the shapes that used to be REFUSED: a step not in the
    // job, or a value that is not a list at all.
    for (const bad of [["archive"], "analyze", 7]) {
      const r = parseJobRequest({ ...REQ, gateAfter: bad }, { resolve, defaults: DEFAULTS });
      expect(`${JSON.stringify(bad)}: ${r.ok}`).toBe(`${JSON.stringify(bad)}: true`);
    }
  });

  // Criterion 9. Nothing a request can say puts a job into the state
  // that no longer exists.
  test("awaiting-approval is not a job state any more", () => {
    expect((JOB_STATES as readonly string[]).includes("awaiting-approval")).toBe(false);
  });

  test("the permission mode and model come from the config, per step", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.permissionMode).toEqual({ analyze: "acceptEdits", implement: "bypassPermissions" });
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "opus" });
  });

  test("unknown fields are ignored", () => {
    const r = parseJobRequest({ ...REQ, nonsense: 1, permissionMode: "bypassPermissions" }, {
      resolve,
      defaults: DEFAULTS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.job as unknown as Record<string, unknown>).nonsense).toBeUndefined();
    // permissionMode is config-only: a request must never be able to
    // widen what an unattended run may do.
    expect(r.job.permissionMode.analyze).toBe("acceptEdits");
  });

  // --- spec 152: the wall clock is per step -----------------------------
  //
  // One number covered analyze (minutes) and implement (the better part
  // of an hour on a twenty-file change) alike, and the only place it
  // could be changed was the config file on the serving host. It is a
  // table now, resolved exactly as `permissionMode` and `model` are.
  test("each step gets its own configured limit", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement", "archive"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.timeoutSec.implement).toBe(5400);
    // Every step the config does not name falls to `default`, the same
    // fallback the other two per-step tables have.
    expect(r.job.timeoutSec.analyze).toBe(1200);
    expect(r.job.timeoutSec.archive).toBe(1200);
  });

  test("an override tightens every step against that step's OWN ceiling", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], timeoutSec: 600 },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.job.timeoutSec).toEqual({ analyze: 600, implement: 600 });

    // 3000 is well inside implement's 5400 and well outside analyze's
    // 1200. The job holds both steps, so it is refused: a request may
    // only tighten, and it does not get to loosen one step by naming
    // another that could have afforded it.
    const mixed = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], timeoutSec: 3000 },
      { resolve, defaults: DEFAULTS },
    );
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error).toContain("timeoutSec");

    // The same number on an implement-only job is a tightening, and is
    // taken.
    const alone = parseJobRequest(
      { ...REQ, steps: ["implement"], timeoutSec: 3000 },
      { resolve, defaults: DEFAULTS },
    );
    expect(alone.ok && alone.job.timeoutSec).toEqual({ implement: 3000 });
  });

  test("an override may tighten a cap but never loosen it", () => {
    const tighter = parseJobRequest({ ...REQ, budgetUsd: 1, timeoutSec: 60 }, { resolve, defaults: DEFAULTS });
    expect(tighter.ok).toBe(true);
    if (tighter.ok) {
      expect(tighter.job.budgetUsd).toBe(1);
      expect(tighter.job.timeoutSec).toEqual({ analyze: 60 });
    }
    const looser = parseJobRequest({ ...REQ, budgetUsd: 50 }, { resolve, defaults: DEFAULTS });
    expect(looser.ok).toBe(false);
    if (!looser.ok) expect(looser.error).toContain("budgetUsd");
  });

  test.each([
    ["an unknown project", { ...REQ, project: "atlasaurus" }, "project"],
    ["a project not in the allowlist", { ...REQ, project: "claude-usage" }, "project"],
    ["a path instead of a name", { ...REQ, project: "../../etc" }, "project"],
    ["an unknown spec folder", { ...REQ, specFolder: "99-nope" }, "specFolder"],
    ["a step that is not a workflow step", { ...REQ, steps: ["deploy"] }, "steps"],
    ["no steps at all", { ...REQ, steps: [] }, "steps"],
    ["a non-object body", "hello", "object"],
  ])("%s is rejected", (_label, body, field) => {
    const r = parseJobRequest(body, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(field);
  });
});

describe("QueueStore", () => {
  test("enqueue lists the job, mirrors it, and a new instance reloads it", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(store.list().map((j) => j.id)).toEqual([r.job.id]);
    expect(existsSync(mirrorPath)).toBe(true);

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.list().map((j) => j.id)).toEqual([r.job.id]);
    expect(reloaded.get(r.job.id)?.specFolder).toBe("81-queue-and-runner");
  });

  test("a rejected request stores nothing", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(store.enqueue({ ...REQ, project: "nope" }).ok).toBe(false);
    expect(store.list()).toEqual([]);
  });

  test("the oldest job is dropped at the cap", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, cap: 3 });
    // Distinct steps: the queue refuses the same step twice while the
    // first is unfinished, so four identical requests would not make
    // four jobs to drop one of.
    const ids = ["analyze", "implement", "archive", "manifest"].map((step) => {
      const r = store.enqueue({ ...REQ, steps: [step] });
      return r.ok ? r.job.id : "";
    });
    expect(store.list().length).toBe(3);
    expect(store.get(ids[0])).toBeUndefined();
    expect(store.get(ids[3])).toBeDefined();
  });

  test("update persists and survives a restart", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    store.update(r.job.id, { state: "cancelled" });
    expect(new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)?.state).toBe("cancelled");
  });

  test("a corrupt mirror is survivable — the store starts empty", () => {
    writeFileSync(mirrorPath, "{not json");
    expect(new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).list()).toEqual([]);
  });

  // Criterion 11 (spec 149). Three jobs on this machine were posted with
  // a gate before the stop between steps was removed, and their records
  // are still in the mirror. A retired FIELD is ignored, like every
  // other unknown key; a retired STATE fails the state check and takes
  // its own row with it, which is the rule a corrupt row has always
  // had — but it must take only its own. A boot that threw, or that
  // dropped the rest of the file with it, would lose every job on the
  // page for the sake of one from August.
  test("a record mirrored with gateAfter or awaiting-approval does not take the file down", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const keep = store.enqueue(REQ);
    expect(keep.ok).toBe(true);
    if (!keep.ok) return;
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    // One row as it was written in August: both retired shapes at once.
    raw.unshift({ ...raw[0], id: "old-gated", state: "awaiting-approval", gateAfter: ["analyze"] });
    // And one that carries only the retired FIELD — that row is fine and
    // stays, minus the field.
    raw.push({ ...raw[raw.length - 1], id: "old-field", gateAfter: ["analyze"] });
    writeFileSync(mirrorPath, JSON.stringify(raw));

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.get(keep.job.id)?.id).toBe(keep.job.id);
    expect(reloaded.get("old-gated")).toBeUndefined();
    const field = reloaded.get("old-field");
    expect(field?.state).toBe("queued");
    // Left behind on the way in, so it is gone from the mirror the
    // store writes back too — a field nothing reads must not survive a
    // reload-and-save round trip.
    expect(field && "gateAfter" in field).toBe(false);
    // Any update rewrites the mirror from what is in memory.
    reloaded.update("old-field", { spentUsd: 1 });
    expect(readFileSync(mirrorPath, "utf-8")).not.toContain("gateAfter");
  });
});

// Criterion 3's data layer (spec 02): the session of the step that is
// running right now. It is worth nothing unless it survives a restart —
// the very case where the run is still going and the page has to say
// what it is doing.
describe("the running step's session", () => {
  test("sessionId and streamFile round-trip through the mirror", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    store.update(r.job.id, {
      state: "running",
      sessionId: "3f7a1c2e-0000-4000-8000-000000000001",
      streamFile: "/tmp/jobs/x.stream.jsonl",
    });

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)!;
    expect(reloaded.sessionId).toBe("3f7a1c2e-0000-4000-8000-000000000001");
    expect(reloaded.streamFile).toBe("/tmp/jobs/x.stream.jsonl");
  });

  test("a malformed sessionId is dropped, not carried — the mirror is validated, never trusted", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    raw[0].sessionId = 42;
    raw[0].streamFile = { path: "/tmp/x" };
    writeFileSync(mirrorPath, JSON.stringify(raw));

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)!;
    expect(reloaded.sessionId).toBeUndefined();
    expect(reloaded.streamFile).toBeUndefined();
  });

  test("a job mirrored before this change reloads without one", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)!;
    expect(reloaded.sessionId).toBeUndefined();
  });
});

describe("mergeQueueDefaults", () => {
  test("a config file overrides what it names and keeps the rest", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      budgetUsd: 15,
      jobCapUsd: 50,
      model: { implement: "opus", archive: "sonnet" },
    });
    expect(merged.budgetUsd).toBe(15);
    expect(merged.jobCapUsd).toBe(50);
    expect(merged.dailyCapUsd).toBe(20); // untouched
    expect(merged.timeoutSec).toEqual(DEFAULTS.timeoutSec);
    expect(merged.model.archive).toBe("sonnet");
    expect(merged.permissionMode.implement).toBe("bypassPermissions");
  });

  test("a per-step timeoutSec table is merged like the other two (spec 152)", () => {
    const merged = mergeQueueDefaults(DEFAULTS, { timeoutSec: { implement: 7200, archive: 900 } });
    expect(merged.timeoutSec).toEqual({ default: 1200, implement: 7200, archive: 900 });
  });

  test("a config still carrying the old flat timeoutSec falls back rather than crashing", () => {
    // The shape changed in spec 152 and the file is edited by hand on
    // the serving host. A number where a table is expected is dropped,
    // the same direction every other malformed key here fails in — the
    // built-in per-step defaults stand until someone edits the file.
    const merged = mergeQueueDefaults(DEFAULTS, { timeoutSec: 2700 });
    expect(merged.timeoutSec).toEqual(DEFAULTS.timeoutSec);
  });

  test("nonsense is ignored rather than obeyed — failing towards spending less", () => {
    const merged = mergeQueueDefaults(DEFAULTS, { budgetUsd: -5, dailyCapUsd: "lots", model: 7 });
    expect(merged.budgetUsd).toBe(3);
    expect(merged.dailyCapUsd).toBe(20);
    expect(merged.model).toEqual(DEFAULTS.model);
  });
});

// Spec 89: which repos does this spec have a branch in RIGHT NOW? A
// spec is taken through its steps as several jobs, and each job knows
// only about the repos its own steps pushed to. The merge route needs
// the union — and never trusts the browser for it.
describe("branchesFor", () => {
  const seed = (store: QueueStore, steps: string[], branchUrls: { root: string; url: string }[]) => {
    const r = store.enqueue({ ...REQ, steps });
    if (!r.ok) throw new Error(r.error);
    store.update(r.job.id, { state: "done", branchUrls, startedAt: "2026-08-17T10:00:00Z" });
    return r.job.id;
  };

  test("a spec with no branch anywhere has nothing to merge", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error(r.error);
    expect(store.branchesFor("aide", "81-queue-and-runner")).toEqual([]);
  });

  test("two jobs for one spec union their repos", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    seed(store, ["analyze"], [{ root: "/repos/aide-specs", url: "https://example.test/specs" }]);
    seed(store, ["implement"], [{ root: "/repos/aide", url: "https://example.test/aide" }]);
    expect(new Set(store.branchesFor("aide", "81-queue-and-runner"))).toEqual(
      new Set([
        { root: "/repos/aide-specs", url: "https://example.test/specs" },
        { root: "/repos/aide", url: "https://example.test/aide" },
      ]),
    );
  });

  test("when both jobs recorded the same root, the most recent one wins", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const older = store.enqueue({ ...REQ, steps: ["analyze"] });
    if (!older.ok) throw new Error(older.error);
    store.update(older.job.id, {
      state: "done",
      startedAt: "2026-08-17T09:00:00Z",
      branchUrls: [{ root: "/repos/aide", url: "https://example.test/old" }],
    });
    const newer = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!newer.ok) throw new Error(newer.error);
    store.update(newer.job.id, {
      state: "done",
      startedAt: "2026-08-17T11:00:00Z",
      branchUrls: [{ root: "/repos/aide", url: "https://example.test/new" }],
    });
    expect(store.branchesFor("aide", "81-queue-and-runner")).toEqual([
      { root: "/repos/aide", url: "https://example.test/new" },
    ]);
  });

  test("another spec's branches are not this spec's", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    seed(store, ["analyze"], [{ root: "/repos/aide", url: "https://example.test/aide" }]);
    expect(store.branchesFor("aide-dashboard", "01-first")).toEqual([]);
  });
});

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

// Two jobs for the same spec and the same step is never what anyone
// meant: it happened on 2026-08-16 when the same analyze was posted
// from the API and from the page seconds apart, and the queue took
// both without a word.
describe("the same work is not queued twice", () => {
  const queued = (extra: Record<string, unknown> = {}) => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const first = store.enqueue({ ...REQ, ...extra });
    if (!first.ok) throw new Error(first.error);
    return { store, first: first.job };
  };

  test("the same step on the same spec is refused while the first is unfinished", () => {
    const { store } = queued();
    const again = store.enqueue(REQ);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toContain("analyze");
    expect(again.error).toContain("81-queue-and-runner");
  });

  test("a job that has been started still blocks — it is not finished", () => {
    const { store, first } = queued();
    store.update(first.id, { state: "running" });
    expect(store.enqueue(REQ).ok).toBe(false);
  });

  test("overlapping by one step is enough to refuse", () => {
    const { store } = queued({ steps: ["analyze", "implement"] });
    const again = store.enqueue({ ...REQ, steps: ["implement", "archive"] });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toContain("implement");
  });

  test("a different step on the same spec is fine — analyze now, implement after", () => {
    const { store } = queued({ steps: ["analyze"] });
    expect(store.enqueue({ ...REQ, steps: ["implement"] }).ok).toBe(true);
  });

  test("the same step on another spec is fine", () => {
    const { store } = queued();
    expect(store.enqueue({ project: "aide-dashboard", specFolder: "01-first", steps: ["analyze"] }).ok).toBe(true);
  });

  for (const state of ["done", "cancelled", "failed", "stopped", "interrupted"] as const) {
    test(`a ${state} job does not block the next one`, () => {
      const { store, first } = queued();
      store.update(first.id, { state });
      expect(store.enqueue(REQ).ok).toBe(true);
    });
  }
});
// A job could name passenger projects — other repos a run would branch,
// commit and push alongside the primary. The tick box that named them
// went when 0 of the queue's 200 jobs had ever used one, and the field
// went with it. What has to keep working is the jobs already mirrored
// with the field: an unknown key is ignored, never refused.
describe("a job mirrored with the retired extraProjects field", () => {
  test("still loads, with the key ignored", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error(r.error);
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    for (const job of raw) job.extraProjects = ["aide-dashboard"];
    writeFileSync(mirrorPath, JSON.stringify(raw));
    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.get(r.job.id)?.specFolder).toBe(r.job.specFolder);
  });

  test("a request that still sends it is accepted, not refused", () => {
    const r = parseJobRequest({ ...REQ, extraProjects: ["aide-dashboard"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
  });
});

// --- spec 93: a spec that does not exist yet ---------------------------------

// Every other request names a spec folder the server has already
// discovered on disk. A create request cannot: the folder is what the
// job is FOR. So it is validated against the raw allowlist instead —
// the one set that knows about a project which has never had a spec —
// and carries a provisional key until `/aide-create` decides the real
// name.
describe("parseCreateRequest", () => {
  const allow = (project: string) => project === "aide" || project === "brandnew";
  const CREATE = { project: "brandnew", title: "A new spec", description: "Do the thing" };

  test("a project with no spec at all is accepted — the allowlist is the whole test", () => {
    // The resolver every other route uses answers null for this
    // project, which is exactly the gap that makes a project's FIRST
    // spec uncreatable today.
    expect(resolve("brandnew")).toBeNull();
    const r = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.project).toBe("brandnew");
    expect(r.job.steps).toEqual(["create"]);
    expect(r.job.createTitle).toBe("A new spec");
    expect(r.job.createDescription).toBe("Do the thing");
    // A provisional key, and one nobody could mistake for a spec folder.
    expect(r.job.specFolder).toMatch(/^new-[0-9a-f]{8}$/);
  });

  test("two create requests never share a key", () => {
    const a = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    const b = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(a.ok && b.ok && a.job.specFolder !== b.job.specFolder).toBe(true);
  });

  test("a project outside the allowlist is refused", () => {
    const r = parseCreateRequest({ ...CREATE, project: "someone-elses" }, { allow, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
  });

  test("the title and the description are required and bounded", () => {
    for (const bad of [
      { ...CREATE, title: "" },
      { ...CREATE, title: "x".repeat(200) },
      { ...CREATE, description: "" },
      { ...CREATE, description: "x".repeat(5000) },
      { ...CREATE, title: 7 },
      {},
    ]) {
      expect(parseCreateRequest(bad, { allow, defaults: DEFAULTS }).ok).toBe(false);
    }
  });

  test("the caps come from the config, exactly as every other job's do", () => {
    const r = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(r.ok && r.job.budgetUsd).toBe(DEFAULTS.budgetUsd);
    expect(r.ok && r.job.jobCapUsd).toBe(DEFAULTS.jobCapUsd);
    expect(r.ok && r.job.timeoutSec).toEqual(DEFAULTS.timeoutSec);
  });
});

// --- spec 110: what a new spec builds on --------------------------------------

// A `Depends on:` line in 1-description.md (spec 92) has had a reader
// since the day it existed and no writer but a person at a shell. The
// create form names it now, so the value arrives as a request field —
// and a name a request supplies is checked against server-known truth,
// never against whatever chips the browser happened to render.
describe("parseCreateRequest — dependsOn", () => {
  const allow = (project: string) => project === "aide" || project === "brandnew";
  const CREATE = { project: "aide", title: "A new spec", description: "Do the thing" };

  test("a same-project active spec is accepted and stored on the job", () => {
    const r = parseCreateRequest(
      { ...CREATE, dependsOn: ["81-queue-and-runner"] },
      { allow, resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.createDependsOn).toEqual(["81-queue-and-runner"]);
  });

  test("an entry belonging to another project, or to none at all, is refused", () => {
    // `01-first` is real — it is `aide-dashboard`'s. A dependency is
    // resolved inside ONE specs root (aide-run-spec's own guard does
    // the same), so another project's folder is as unknown as a made-up
    // one.
    for (const bad of [["01-first"], ["no-such-spec"], ["../etc/passwd"], [7]]) {
      const r = parseCreateRequest({ ...CREATE, dependsOn: bad }, { allow, resolve, defaults: DEFAULTS });
      expect(r.ok).toBe(false);
    }
  });

  test("a repeat is refused, and so is a value that is not a list", () => {
    expect(
      parseCreateRequest(
        { ...CREATE, dependsOn: ["81-queue-and-runner", "81-queue-and-runner"] },
        { allow, resolve, defaults: DEFAULTS },
      ).ok,
    ).toBe(false);
    expect(
      parseCreateRequest({ ...CREATE, dependsOn: "81-queue-and-runner" }, { allow, resolve, defaults: DEFAULTS }).ok,
    ).toBe(false);
  });

  test("nothing chosen means no field at all — exactly today's behaviour", () => {
    const r = parseCreateRequest(CREATE, { allow, resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.createDependsOn).toBeUndefined();
    // And a caller that passes no resolver at all still parses: the six
    // calls above this block do exactly that, and a create that names
    // nothing has nothing to look up.
    expect(parseCreateRequest(CREATE, { allow, defaults: DEFAULTS }).ok).toBe(true);
  });

  test("a project whose first spec this is has nothing to depend on", () => {
    const r = parseCreateRequest(
      { ...CREATE, project: "brandnew", dependsOn: ["81-queue-and-runner"] },
      { allow, resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
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

describe("QueueStore.enqueueCreate", () => {
  const allow = (project: string) => project === "brandnew";
  const CREATE = { project: "brandnew", title: "A new spec", description: "Do the thing" };

  test("a create job goes into the same store as every other job", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, allowCreateProject: allow });
    const r = store.enqueueCreate(CREATE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(store.get(r.job.id)?.createTitle).toBe("A new spec");
    // ...and it survives a restart, like every other job.
    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, allowCreateProject: allow });
    expect(reloaded.get(r.job.id)?.createDescription).toBe("Do the thing");
  });

  test("a chosen dependency survives a restart, like the title and the description", () => {
    // "aide" here, not "brandnew": a dependency is one of the project's
    // OWN active specs, and a project having none is the whole reason
    // the create route exists at all.
    const allowAide = (project: string) => project === "aide";
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, allowCreateProject: allowAide });
    const r = store.enqueueCreate({ ...CREATE, project: "aide", dependsOn: ["81-queue-and-runner"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(store.get(r.job.id)?.createDependsOn).toEqual(["81-queue-and-runner"]);
    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, allowCreateProject: allowAide });
    expect(reloaded.get(r.job.id)?.createDependsOn).toEqual(["81-queue-and-runner"]);
  });

  test("without a create allowlist nothing may be created", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(store.enqueueCreate(CREATE).ok).toBe(false);
  });
});

// --- spec 171: resolve is not a step at all -----------------------------------
//
// It was one until spec 171 folded the routine into `archive`. The
// vocabulary is what enforces that: a post that still names it — an old
// bookmark, a stale queue-config, a hand-written request — is refused as
// an invalid entry in `steps`, before anything reaches the runner.

describe("the retired resolve step (spec 171)", () => {
  test("a job may no longer be queued for it", () => {
    const r = parseJobRequest({ ...REQ, steps: ["resolve"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
  });

  test("archive is still queueable, and runs on the config's default model", () => {
    const r = parseJobRequest({ ...REQ, steps: ["archive"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.steps).toEqual(["archive"]);
    // A merge is not an implement: archive keeps the default model even
    // now that it may have a resolution to do.
    expect(r.job.model.archive).toBe("sonnet");
  });
});

// --- spec 112: the allowlist lives in the config file ------------------------
//
// It used to be a `--queue-projects` argument baked into the launchd
// plist, so adding a project meant re-rendering the plist and
// restarting the server. The list moves into `queue-config.json`, which
// the server already reads: `--queue-projects` stays, as the seed for a
// first install where that file does not exist yet.
describe("the project allowlist round-trips through queue-config.json", () => {
  const configDirs: string[] = [];
  const configFile = (contents?: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-projects-"));
    configDirs.push(dir);
    const file = join(dir, "queue-config.json");
    if (contents) writeFileSync(file, JSON.stringify(contents, null, 2));
    return file;
  };

  afterEach(() => {
    while (configDirs.length) rmSync(configDirs.pop()!, { recursive: true, force: true });
  });

  test("a written list is read back as the allowlist (criterion 9)", () => {
    const file = configFile({ concurrency: 3 });
    expect(persistQueueProjects(file, ["aide", "atlasaurus"])).toBeNull();
    const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide"]);
    expect(opts.queueProjects).toEqual(["aide", "atlasaurus"]);
  });

  test("the file's other keys survive the write", () => {
    const file = configFile({ concurrency: 3, push: "none", notifyCommand: ["/bin/echo", "hi"] });
    persistQueueProjects(file, ["aide"]);
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    expect(raw).toEqual({
      concurrency: 3,
      push: "none",
      notifyCommand: ["/bin/echo", "hi"],
      projects: ["aide"],
    });
    const opts = parseArgs(["--queue-config", file]);
    expect(opts.queueConcurrency).toBe(3);
    expect(opts.queuePush).toBe("none");
    expect(opts.queueNotifyCommand).toEqual(["/bin/echo", "hi"]);
  });

  test("the config beats a conflicting --queue-projects (criterion 10)", () => {
    const file = configFile({ projects: ["atlasaurus"] });
    const opts = parseArgs([
      "--queue-config", file,
      "--queue-projects", "aide,aide-dashboard",
    ]);
    expect(opts.queueProjects).toEqual(["atlasaurus"]);
  });

  test("no projects field means the CLI flag still seeds a first install", () => {
    const file = configFile({ concurrency: 2 });
    const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide,aide-dashboard"]);
    expect(opts.queueProjects).toEqual(["aide", "aide-dashboard"]);
  });

  test("an empty list is a real answer, not a missing one", () => {
    const file = configFile({ projects: [] });
    const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide"]);
    expect(opts.queueProjects).toEqual([]);
  });

  test("a malformed projects field is ignored, and the flag is kept", () => {
    for (const projects of ["aide", [1, 2], ["../escape"], ["a/b"], {}]) {
      const file = configFile({ projects });
      const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide"]);
      expect([projects, opts.queueProjects]).toEqual([projects, ["aide"]]);
    }
  });

  test("the config file path reaches the server, so a route can write it", () => {
    const file = configFile({ projects: ["aide"] });
    expect(parseArgs(["--queue-config", file]).queueConfigFile).toBe(file);
  });

  // Criterion 15: the write is derived from the caller's list and lands
  // synchronously, so two in a row cannot interleave — the second sees
  // the first's file, and neither reads a copy taken before the other
  // wrote.
  test("two writes in immediate succession both land", () => {
    const file = configFile({ concurrency: 2 });
    const allowed = new Set(["aide"]);
    allowed.add("atlasaurus");
    persistQueueProjects(file, [...allowed]);
    allowed.delete("aide");
    persistQueueProjects(file, [...allowed]);
    expect(parseArgs(["--queue-config", file]).queueProjects).toEqual(["atlasaurus"]);
  });

  test("a config file that does not exist yet is created", () => {
    const file = configFile();
    expect(existsSync(file)).toBe(false);
    expect(persistQueueProjects(file, ["aide"])).toBeNull();
    expect(parseArgs(["--queue-config", file]).queueProjects).toEqual(["aide"]);
  });

  test("a path that cannot be written is reported, never thrown", () => {
    // A file where a directory would have to be: mkdir -p cannot help.
    const blocked = configFile({});
    const error = persistQueueProjects(join(blocked, "c.json"), ["aide"]);
    expect(typeof error).toBe("string");
  });
});

// --- spec 160: a later phase can be added while the job runs ------------------

// A run started with too few phases meant waiting for it to end and
// pressing Run again; one started with too many meant Cancel and start
// over. Both are the reader knowing more at minute ten than at minute
// zero. The tail of a RUNNING job's step list is editable — and only
// the tail: what has run, and what is running, is not up for a second
// opinion.
describe("editing a running job's tail (spec 160)", () => {
  /** A job in the store, running the step at `stepIndex`. The state is
   *  set through `update()` rather than by a runner: what these tests
   *  are about is the store's own rule, and a runner would only make
   *  the fixture slower to state. */
  let made_ = 0;
  const running = (steps: string[], stepIndex = 0) => {
    // A mirror of its own per job: a second store on the same file
    // loads the first one's job and refuses the enqueue as a clash.
    const mirror = join(dir, `queue-${(made_ += 1)}.json`);
    const store = new QueueStore({ defaults: DEFAULTS, resolve, mirrorPath: mirror });
    const made = store.enqueue({ ...REQ, steps });
    if (!made.ok) throw new Error(made.error);
    store.update(made.job.id, { state: "running", stepIndex });
    return { store, mirror, id: made.job.id, steps: () => store.get(made.job.id)!.steps };
  };

  test("an added step lands in WORKFLOW_STEPS order, not at the array end (criterion 1)", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailStep(job.id, "archive", true).ok).toBe(true);
    expect(job.store.editTailStep(job.id, "implement", true).ok).toBe(true);
    expect(job.steps()).toEqual(["analyze", "implement", "archive"]);
    // The running step is where it was: the head of the list is not
    // touched by an edit to the tail.
    expect(job.store.get(job.id)!.stepIndex).toBe(0);
  });

  test("a not-yet-started step can be removed (criterion 2)", () => {
    const job = running(["analyze", "implement", "archive"]);
    const answer = job.store.editTailStep(job.id, "implement", false);
    expect(answer.ok).toBe(true);
    expect(job.steps()).toEqual(["analyze", "archive"]);
    expect(job.store.get(job.id)!.stepIndex).toBe(0);
  });

  test("the running step and everything behind it are closed (criterion 3)", () => {
    const job = running(["analyze", "implement"], 1);
    for (const [step, add] of [
      ["implement", false], ["implement", true],
      ["analyze", false], ["analyze", true],
    ] as const) {
      const answer = job.store.editTailStep(job.id, step, add);
      expect(`${step} ${add}: ${answer.ok}`).toBe(`${step} ${add}: false`);
      // Named, never a bare "no": the row has one line to say why.
      if (!answer.ok) expect(answer.error).toContain(step);
    }
    expect(job.steps()).toEqual(["analyze", "implement"]);
  });

  // The step the reader is looking at may finish between the page
  // rendering and the tick arriving. The store decides against the job
  // as it is at that instant, never against what the page believed.
  test("a step the runner has walked past since the page drew it is refused by name (criterion 4)", () => {
    const job = running(["analyze", "implement"]);
    // What the page believed: implement has not started, so its box is
    // live and unticking it would drop it. Then the runner moves on.
    job.store.update(job.id, { stepIndex: 1 });
    const answer = job.store.editTailStep(job.id, "implement", false);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toContain("implement");
    expect(job.steps()).toEqual(["analyze", "implement"]);
  });

  test("a job that is not running is closed altogether (criterion 6)", () => {
    for (const state of ["queued", "done", "failed", "cancelled", "stopped", "interrupted"] as const) {
      const job = running(["analyze"]);
      job.store.update(job.id, { state });
      const answer = job.store.editTailStep(job.id, "implement", true);
      expect(`${state}: ${answer.ok}`).toBe(`${state}: false`);
      expect(job.steps()).toEqual(["analyze"]);
    }
  });

  test("a step already in the job cannot be added a second time", () => {
    const job = running(["analyze", "archive"]);
    const answer = job.store.editTailStep(job.id, "archive", true);
    expect(answer.ok).toBe(false);
    expect(job.steps()).toEqual(["analyze", "archive"]);
  });

  // A job created without every earlier step ticked would otherwise
  // show the missing one as live, and adding it would run it AFTER the
  // step now running — out of the only order these steps have.
  test("a step that ranks earlier than the one running is refused (criterion 9)", () => {
    const job = running(["implement", "archive"]);
    const answer = job.store.editTailStep(job.id, "analyze", true);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toContain("analyze");
    expect(job.steps()).toEqual(["implement", "archive"]);
  });

  test("an unknown job is not found", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailStep("no-such-job", "implement", true).ok).toBe(false);
  });

  // The mirror is what survives a restart, and a tail edited only in
  // memory would be undone by one.
  test("the edit reaches the mirror", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailStep(job.id, "implement", true).ok).toBe(true);
    const stored = JSON.parse(readFileSync(job.mirror, "utf-8")) as { id: string; steps: string[] }[];
    expect(stored.find((j) => j.id === job.id)!.steps).toEqual(["analyze", "implement"]);
  });

  // What the ROW needs to know before it draws a box: which steps are
  // still open to a tick. One function answers it for the store's own
  // refusal and for the page alike, so the two cannot drift apart.
  describe("tailEdits", () => {
    test("names the tail and every later step the job does not have, in workflow order", () => {
      const job = running(["analyze", "archive"]);
      expect(tailEdits(job.store.get(job.id)!)).toEqual(["implement", "archive"]);
    });

    test("a job that is not running has nothing open (criterion 8)", () => {
      const job = running(["analyze", "archive"]);
      job.store.update(job.id, { state: "queued" });
      expect(tailEdits(job.store.get(job.id)!)).toEqual([]);
    });

    test("nothing earlier than the running step is offered (criterion 9)", () => {
      const job = running(["implement", "archive"]);
      expect(tailEdits(job.store.get(job.id)!)).not.toContain("analyze");
    });
  });
});

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

// --- spec 189: the store says when it changed --------------------------------

// The page used to ask every five seconds whether anything had moved.
// It asks nothing now: the server tells it. Every write to a job goes
// through one of three methods here, so one hook on the three of them
// is the whole of the server's half of "something changed" — and a
// write that was REFUSED changed nothing, so it must stay silent, or
// the page redraws for a clash it already has the refusal for.
describe("QueueStore.onChange (spec 189)", () => {
  /** A store that counts the changes it announces. Its own mirror per
   *  call, for the reason the tail-edit fixture gives: a second store
   *  on one file loads the first one's job and calls the enqueue a
   *  clash. */
  let made_ = 0;
  const counting = () => {
    const mirror = join(dir, `queue-onchange-${(made_ += 1)}.json`);
    let fired = 0;
    const store = new QueueStore({
      defaults: DEFAULTS,
      resolve,
      mirrorPath: mirror,
      allowCreateProject: (project) => project === "aide",
      onChange: () => void (fired += 1),
    });
    return { store, fired: () => fired };
  };

  test("fires after a successful enqueue", () => {
    const c = counting();
    expect(c.store.enqueue(REQ).ok).toBe(true);
    expect(c.fired()).toBe(1);
  });

  test("fires after a successful enqueueCreate", () => {
    const c = counting();
    const made = c.store.enqueueCreate({ project: "aide", title: "A new thing", description: "why" });
    expect(made.ok).toBe(true);
    expect(c.fired()).toBe(1);
  });

  test("fires after update — the runner's every step transition", () => {
    const c = counting();
    const made = c.store.enqueue(REQ);
    if (!made.ok) throw new Error(made.error);
    expect(c.store.update(made.job.id, { state: "running" })).toBeDefined();
    expect(c.store.update(made.job.id, { state: "done" })).toBeDefined();
    expect(c.fired()).toBe(3); // the enqueue and the two updates
  });

  test("fires after a successful editTailStep", () => {
    const c = counting();
    const made = c.store.enqueue({ ...REQ, steps: ["analyze"] });
    if (!made.ok) throw new Error(made.error);
    c.store.update(made.job.id, { state: "running", stepIndex: 0 });
    expect(c.store.editTailStep(made.job.id, "implement", true).ok).toBe(true);
    expect(c.fired()).toBe(3); // the enqueue, the update, the edit
  });

  test("stays silent when an enqueue is refused as a clash", () => {
    const c = counting();
    expect(c.store.enqueue(REQ).ok).toBe(true);
    const before = c.fired();
    expect(c.store.enqueue(REQ).ok).toBe(false);
    expect(c.fired()).toBe(before);
  });

  test("stays silent when the request never parsed", () => {
    const c = counting();
    expect(c.store.enqueue({ project: "nope", specFolder: "x", steps: ["analyze"] }).ok).toBe(false);
    expect(c.fired()).toBe(0);
  });

  test("stays silent when update names a job that does not exist", () => {
    const c = counting();
    expect(c.store.update("no-such-job", { state: "done" })).toBeUndefined();
    expect(c.fired()).toBe(0);
  });

  test("stays silent when editTailStep is refused", () => {
    const c = counting();
    const made = c.store.enqueue({ ...REQ, steps: ["analyze"] });
    if (!made.ok) throw new Error(made.error);
    c.store.update(made.job.id, { state: "running", stepIndex: 0 });
    const before = c.fired();
    // The running step itself, an unknown job, and a step name that is
    // not a step at all: three refusals, no announcement.
    expect(c.store.editTailStep(made.job.id, "analyze", false).ok).toBe(false);
    expect(c.store.editTailStep("no-such-job", "implement", true).ok).toBe(false);
    expect(c.store.editTailStep(made.job.id, "not-a-step", true).ok).toBe(false);
    expect(c.fired()).toBe(before);
  });

  // Every other store in the tests is built without the hook, and a
  // store that required one would be a change to every caller.
  test("a store built without the hook still works", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve, mirrorPath });
    expect(store.enqueue(REQ).ok).toBe(true);
  });
});
