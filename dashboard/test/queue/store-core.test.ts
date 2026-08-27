import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PHASE_STEPS,
  QueueStore,
  currentWorkRoundJobs,
  parseJobRequest,
  type QueueDefaults,
} from "../../src/queue/queue.ts";

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

// --- spec 198: reopening is a step like any other ---------------------------
//
// The dashboard's Reopen control and `/aide-reopen` in a terminal are
// one operation, and the way to keep them one is to give them one path:
// both enqueue `reopen`, which drives `aide-run-spec --command reopen`
// exactly as `archive` and `analyze` already do. Nothing about the
// enqueue is special-cased for it — which is what the test below is
// about.
describe("spec 198: reopen", () => {
  test("is a step the queue accepts", () => {
    const r = parseJobRequest({ ...REQ, steps: ["reopen"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.steps).toEqual(["reopen"]);
  });

  // It is queueable, not a stage a spec passes through: `explore` and
  // `manifest` are in `WORKFLOW_STEPS` for the same reason, and neither
  // draws a phase box.
  test("is not one of the phases a row draws a box for", () => {
    expect([...PHASE_STEPS] as string[]).not.toContain("reopen");
  });

  // An archived spec is not among a project's `specFolders` — the page
  // drops it, deliberately — so the resolver names it in a list of its
  // own and this is what that list buys.
  const withArchived = () => ({
    specFolders: ["81-queue-and-runner"],
    archivedFolders: ["17-clean-up-console-log"],
  });

  test("an archived spec can be asked for reopen", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reopen"] },
      { resolve: withArchived, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
  });

  // Spec 193 relies on an archived spec being refused unless its branch
  // is still open, and that exception lives in `specFolders`. Admitting
  // the archive for `reopen` must not admit it for anything else.
  test("an archived spec is refused every other step, by name", () => {
    for (const step of ["archive", "implement", "analyze"]) {
      const r = parseJobRequest(
        { ...REQ, specFolder: "17-clean-up-console-log", steps: [step] },
        { resolve: withArchived, defaults: DEFAULTS },
      );
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain("archived");
    }
  });

  test("a reopen bundled with a step that is not one is refused whole", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reopen", "analyze"] },
      { resolve: withArchived, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
  });

  // A spec nobody has heard of still hears about the folder first: the
  // step check is second, so the error a reader gets is the one that
  // explains the most.
  test("a folder in neither list is unknown, whatever the step", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "99-never-existed", steps: ["reopen"] },
      { resolve: withArchived, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("unknown specFolder");
  });

  // A resolver that names no archived folders at all — every caller
  // before this field existed — behaves exactly as it did.
  test("a resolver with no archived list refuses an archived folder outright", () => {
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reopen"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("unknown specFolder");
  });
});

describe("spec 231: reset", () => {
  test("an active spec can be asked for reset", () => {
    const r = parseJobRequest({ ...REQ, steps: ["reset"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.steps).toEqual(["reset"]);
  });

  test("reset is not a workflow phase and is refused for an archived spec", () => {
    expect([...PHASE_STEPS] as string[]).not.toContain("reset");
    const r = parseJobRequest(
      { ...REQ, specFolder: "17-clean-up-console-log", steps: ["reset"] },
      {
        resolve: () => ({
          specFolders: ["81-queue-and-runner"],
          archivedFolders: ["17-clean-up-console-log"],
        }),
        defaults: DEFAULTS,
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("archived");
  });

  test("only jobs after a successfully landed Reset belong to the current round", () => {
    const jobs = [
      { steps: ["analyze"], state: "done", createdAt: "2026-08-24T10:00:00Z" },
      { steps: ["reset"], state: "done", createdAt: "2026-08-24T11:00:00Z" },
      { steps: ["analyze"], state: "failed", createdAt: "2026-08-24T12:00:00Z" },
    ];
    expect(currentWorkRoundJobs(jobs)).toEqual([jobs[2]]);
  });

  test("a Reset still landing is not a boundary yet", () => {
    const jobs = [
      { steps: ["analyze"], state: "done", createdAt: "2026-08-24T10:00:00Z" },
      { steps: ["reset"], state: "done", landing: true, createdAt: "2026-08-24T11:00:00Z" },
    ];
    expect(currentWorkRoundJobs(jobs)).toEqual(jobs);
  });
});
