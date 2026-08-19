// Criterion 5 (spec 81): the queue store — a job is validated against
// the discovered, allowlisted projects and their real spec folders;
// unknown fields are ignored; per-job overrides may only tighten the
// configured caps, never loosen them; the mirror survives a restart.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QueueStore, mergeQueueDefaults, parseCreateRequest, parseJobRequest, type QueueDefaults,
} from "../src/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: 1200,
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
    expect(r.job.timeoutSec).toBe(1200);
    expect(r.job.spentUsd).toBe(0);
    expect(r.job.stepIndex).toBe(0);
  });

  test("gateAfter defaults to every step, and may be emptied to run straight through", () => {
    const all = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(all.ok && all.job.gateAfter).toEqual(["analyze", "implement"]);
    const none = parseJobRequest({ ...REQ, gateAfter: [] }, { resolve, defaults: DEFAULTS });
    expect(none.ok && none.job.gateAfter).toEqual([]);
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

  test("an override may tighten a cap but never loosen it", () => {
    const tighter = parseJobRequest({ ...REQ, budgetUsd: 1, timeoutSec: 60 }, { resolve, defaults: DEFAULTS });
    expect(tighter.ok).toBe(true);
    if (tighter.ok) {
      expect(tighter.job.budgetUsd).toBe(1);
      expect(tighter.job.timeoutSec).toBe(60);
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
    ["a gate for a step not in the job", { ...REQ, gateAfter: ["archive"] }, "gateAfter"],
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
      model: { implement: "opus", "review-plan": "sonnet" },
    });
    expect(merged.budgetUsd).toBe(15);
    expect(merged.jobCapUsd).toBe(50);
    expect(merged.dailyCapUsd).toBe(20); // untouched
    expect(merged.timeoutSec).toBe(1200);
    expect(merged.model["review-plan"]).toBe("sonnet");
    expect(merged.permissionMode.implement).toBe("bypassPermissions");
  });

  test("nonsense is ignored rather than obeyed — failing towards spending less", () => {
    const merged = mergeQueueDefaults(DEFAULTS, { budgetUsd: -5, dailyCapUsd: "lots", model: 7 });
    expect(merged.budgetUsd).toBe(3);
    expect(merged.dailyCapUsd).toBe(20);
    expect(merged.model).toEqual(DEFAULTS.model);
  });
});

describe("stepsCompletedFor", () => {
  test("a step the queue actually ran counts, whatever the status file says", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!r.ok) throw new Error(r.error);
    expect(store.stepsCompletedFor("aide", "81-queue-and-runner")).toEqual([]);
    store.update(r.job.id, {
      state: "done",
      results: [
        {
          step: "implement",
          ok: true,
          costUsd: 12.34,
          costMeasured: true,
          terminalReason: "completed",
          at: "2026-08-16T18:00:00Z",
        },
      ],
    });
    expect(store.stepsCompletedFor("aide", "81-queue-and-runner")).toEqual(["implement"]);
    // Another spec's history is not this spec's.
    expect(store.stepsCompletedFor("aide-dashboard", "01-first")).toEqual([]);
  });

  test("a step that did NOT succeed does not count", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!r.ok) throw new Error(r.error);
    store.update(r.job.id, {
      state: "stopped",
      results: [
        {
          step: "implement",
          ok: false,
          costUsd: 15,
          costMeasured: false,
          terminalReason: "budget",
          at: "2026-08-16T18:00:00Z",
        },
      ],
    });
    expect(store.stepsCompletedFor("aide", "81-queue-and-runner")).toEqual([]);
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

  test("a job waiting for approval still blocks — it is not finished", () => {
    const { store, first } = queued();
    store.update(first.id, { state: "awaiting-approval" });
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

// Spec 83: a job's work often spans more than the project and its specs
// repo. Spec 81's own implement step wrote to a third repository the run
// knew nothing about, so half the work sat uncommitted on the machine
// while the result reported success. A job may now name the other
// projects it expects to touch — by NAME, resolved against the same
// allowlist as the primary, never as a path.
describe("passenger projects", () => {
  test("an allowlisted extra project is carried on the job", () => {
    const r = parseJobRequest({ ...REQ, extraProjects: ["aide-dashboard"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.extraProjects).toEqual(["aide-dashboard"]);
  });

  test("no extra projects named leaves an empty list, not undefined", () => {
    const r = parseJobRequest(REQ, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.extraProjects).toEqual([]);
  });

  test("a project outside the allowlist is refused", () => {
    const r = parseJobRequest({ ...REQ, extraProjects: ["claude-usage"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("extraProjects");
    expect(r.error).toContain("claude-usage");
  });

  test("naming the primary project again is refused — it is already watched", () => {
    const r = parseJobRequest({ ...REQ, extraProjects: ["aide"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
  });

  test("a repeated entry is refused", () => {
    const r = parseJobRequest(
      { ...REQ, extraProjects: ["aide-dashboard", "aide-dashboard"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
  });

  test("more than four is refused", () => {
    const many = ["a", "b", "c", "d", "e"];
    const r = parseJobRequest({ ...REQ, extraProjects: many }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
  });

  test("a non-list is refused", () => {
    const r = parseJobRequest({ ...REQ, extraProjects: "aide-dashboard" }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
  });

  test("it survives a restart", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue({ ...REQ, extraProjects: ["aide-dashboard"] });
    if (!r.ok) throw new Error(r.error);
    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.get(r.job.id)?.extraProjects).toEqual(["aide-dashboard"]);
  });

  test("a job mirrored before this change reloads with an empty list", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error(r.error);
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    for (const job of raw) delete job.extraProjects;
    writeFileSync(mirrorPath, JSON.stringify(raw));
    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.get(r.job.id)?.extraProjects).toEqual([]);
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
    expect(r.job.gateAfter).toEqual([]);
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
    expect(r.ok && r.job.timeoutSec).toBe(DEFAULTS.timeoutSec);
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

  test("without a create allowlist nothing may be created", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(store.enqueueCreate(CREATE).ok).toBe(false);
  });
});

// --- spec 106: resolve is a step like the others ------------------------------
//
// The "let aide resolve it" control posts an ordinary job with
// `steps: ["resolve"]`. Nothing about cost, caps, concurrency or model
// selection is new — but the step has to be IN the vocabulary, or the
// post is refused as "invalid entry in steps" before it reaches the
// runner.

describe("the resolve step (spec 106)", () => {
  test("a job may be queued for it", () => {
    const r = parseJobRequest({ ...REQ, steps: ["resolve"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.steps).toEqual(["resolve"]);
  });

  test("it runs on the config's default model — a merge is not an implement", () => {
    const r = parseJobRequest({ ...REQ, steps: ["resolve"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model.resolve).toBe("sonnet");
  });

  test("a config that names it explicitly is still honoured", () => {
    const named = { ...DEFAULTS, model: { ...DEFAULTS.model, resolve: "sonnet" } };
    const r = parseJobRequest({ ...REQ, steps: ["resolve"] }, { resolve, defaults: named });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model.resolve).toBe("sonnet");
  });
});
