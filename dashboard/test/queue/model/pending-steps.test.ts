// Spec 439: a phase choice made on New spec, or left on a row's own
// checkboxes at a later Run, survives the row's next render — the
// store's own half, mirroring `pending-models.test.ts` and
// `pending-effort.test.ts` exactly. `setPendingSteps()` records the
// choice the way `setPendingModel()`/`setPendingEffort()` already do;
// `enqueueCreate()` seeds it from what New spec posted, and the row-run
// route (`job-actions.ts`, `POST /api/queue`) seeds it again from
// whatever the reader ticked and pressed Run on — covered here at the
// HTTP level, since that hook lives in the route, not in the store's
// generic `enqueue()`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-pending-steps-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("QueueStore.setPendingSteps() (spec 439)", () => {
  test("records a valid choice", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingSteps("aide", "81-queue-and-runner", ["analyze"]);
    expect(result.ok).toBe(true);
    expect(store.pendingSteps["aide/81-queue-and-runner"]).toEqual(["analyze"]);
  });

  // AC-5's own case: "nothing ticked" is a real, recorded answer — never
  // an absent one indistinguishable from a spec nobody has ever ticked
  // anything on.
  test("records an empty choice as an empty list, not as no entry at all", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingSteps("aide", "81-queue-and-runner", []);
    expect(store.pendingSteps["aide/81-queue-and-runner"]).toEqual([]);
  });

  // Filtered against PHASE_STEPS, not WORKFLOW_STEPS: `reset`/`close`
  // are real steps a job may carry, but neither is a phase a row's own
  // checkbox could ever have ticked, and must never be recorded as if
  // one had been.
  test("drops anything that is not analyze/implement/archive, by name", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingSteps("aide", "81-queue-and-runner", ["analyze", "reset", "bogus", "archive"]);
    expect(store.pendingSteps["aide/81-queue-and-runner"]).toEqual(["analyze", "archive"]);
  });

  test("a second choice for the same spec replaces the first, not merges with it", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingSteps("aide", "81-queue-and-runner", ["analyze", "implement"]);
    store.setPendingSteps("aide", "81-queue-and-runner", ["archive"]);
    expect(store.pendingSteps["aide/81-queue-and-runner"]).toEqual(["archive"]);
  });

  test("persists across a fresh QueueStore instance pointed at the same file", () => {
    const pendingStepsPath = join(dir, "pending-steps.json");
    const first = new QueueStore({ defaults: DEFAULTS, resolve, pendingStepsPath });
    first.setPendingSteps("aide", "81-queue-and-runner", ["analyze"]);

    const second = new QueueStore({ defaults: DEFAULTS, resolve, pendingStepsPath });
    expect(second.pendingSteps["aide/81-queue-and-runner"]).toEqual(["analyze"]);
  });

  test("written tmp-then-renamed, like every other file this store writes", () => {
    const pendingStepsPath = join(dir, "pending-steps.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingStepsPath });
    store.setPendingSteps("aide", "81-queue-and-runner", ["analyze"]);
    const raw = JSON.parse(readFileSync(pendingStepsPath, "utf-8")) as unknown;
    expect(raw).toEqual({ "aide/81-queue-and-runner": ["analyze"] });
  });

  test("a malformed file on disk is dropped, not crashed on", () => {
    const pendingStepsPath = join(dir, "pending-steps.json");
    writeFileSync(pendingStepsPath, "not json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingStepsPath });
    expect(store.pendingSteps).toEqual({});
  });
});

describe("what records a phase choice, and what must not (spec 439)", () => {
  const allow = (project: string) => project === "brandnew";

  test("enqueueCreate() seeds the choice from the posted steps", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve, allowCreateProject: allow });
    const result = store.enqueueCreate({
      project: "brandnew",
      title: "A new spec",
      description: "Do the thing",
      steps: ["analyze"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.pendingSteps[`${result.job.project}/${result.job.specFolder}`]).toEqual(["analyze"]);
  });

  // An untouched New-spec form posts no `steps` at all, which
  // `parseCreateRequest` reads as `["create"]` — every phase after
  // create left for the reader to tick later. That is recorded as an
  // explicit empty choice, not left unrecorded: AC-1's own "some phases
  // after create unticked" case, at its most literal.
  test("enqueueCreate() with no extra steps records an explicit empty choice", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve, allowCreateProject: allow });
    const result = store.enqueueCreate({ project: "brandnew", title: "A new spec", description: "Do the thing" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.pendingSteps[`${result.job.project}/${result.job.specFolder}`]).toEqual([]);
  });

  // The generic `enqueue()` is deliberately NOT hooked: it is also
  // called with synthetic, non-phase step lists by reset, close and the
  // scheduler (3-solution.md's Risk analysis), none of which carry a
  // reader's own phase-checkbox choice. A direct call bypasses the
  // row-run ROUTE's own seeding (`job-actions.ts`, covered below at the
  // HTTP level) the same way those three callers do.
  test("the generic enqueue() never touches a recorded choice, whatever steps it carries", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingSteps("aide", "81-queue-and-runner", ["implement"]);
    const result = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["reset"] });
    expect(result.ok).toBe(true);
    expect(store.pendingSteps["aide/81-queue-and-runner"]).toEqual(["implement"]);
  });

  test("the generic enqueue() records nothing new for a spec with no prior choice", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["reset"] });
    expect(result.ok).toBe(true);
    expect(store.pendingSteps["aide/81-queue-and-runner"]).toBeUndefined();
  });
});

// --- the row-run route's own seeding (job-actions.ts, POST /api/queue) -----
//
// The hook lives in the ROUTE, not in the store, so it is exercised
// here through a real server the way `row-phase-run.test.ts` already
// does for the rest of that route's behaviour.
describe("POST /api/queue records the row's own choice (spec 439)", () => {
  const TOKEN = "s3cret-pending-steps";
  const harness = queueHarness("aide-pending-steps-route-");
  afterEach(() => harness.cleanup());

  const openQuery = "open=" + encodeURIComponent("aide/81-queue-and-runner");

  test("a Run submission's ticks are what the row shows on its next render", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const auth = { headers: { "x-aide-token": TOKEN } };
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { ...auth.headers, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "archive" }).toString(),
    });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: { id: string } };
    // Cancelled, not left queued: with no runner configured this
    // harness's job would sit `queued` forever, and a busy row reads its
    // boxes off the JOB's own tail (`g.lead.steps`, spec 160) rather than
    // off the recorded choice — which would make this pass for the wrong
    // reason. Cancelling settles the job so the row goes idle, which is
    // the render this test is actually about: what the row shows once
    // there is no job left to speak for it.
    await fetch(`${base}/api/queue/${job.id}/cancel`, { method: "POST", ...auth });
    const html = await (await fetch(`${base}/?${openQuery}`, auth)).text();
    const ticked = [...html.matchAll(/<input type="checkbox" name="steps" value="([^"]+)" checked/g)].map(
      (m) => m[1],
    );
    expect(ticked).toEqual(["archive"]);
  });

  test("a refused submission (an unknown step) records nothing", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "resolve" }).toString(),
    });
    expect(res.status).toBe(400);
    // Nothing was ticked before this, and the refused press must not
    // have written an empty choice over what a later, real Run would
    // otherwise have found unset — the fallback stays available for it.
    const html = await (await fetch(`${base}/?${openQuery}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('value="analyze" checked');
  });
});
