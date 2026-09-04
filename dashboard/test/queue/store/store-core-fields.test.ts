import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, parseJobRequest, type QueueDefaults } from "../../../src/queue/queue.ts";

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
