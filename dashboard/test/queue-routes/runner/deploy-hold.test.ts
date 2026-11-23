// A queued deploy waits while a landing is in flight, with the reason on its
// row, and starts on the first tick after the landing has settled.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { formatSentence } from "../../../src/messages/format.ts";
import { deployLandingHolds, type ScheduleContext } from "../../../src/serve/schedules";
import { cleanupHarness, enqueue, makeRunner, resetHarness, spawns, store } from "../../queue/runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const deploy = () => enqueue({ specFolder: "deploy", steps: ["deploy"] });

/** The schedule's own context, as far as the fixed holds read it. */
const ctx = (): ScheduleContext => ({ queue: store }) as unknown as ScheduleContext;

/** A job whose step has ended and whose branch is being merged. */
function landing() {
  const job = enqueue({ specFolder: "91-parallel-spec-runs" });
  store.update(job.id, { landing: true, state: "done" });
  store.waiting.admitted.add(job.id);
  return job;
}

describe("a queued deploy is held back while a landing is in flight", () => {
  test("the holds name the deploy with the landing sentence, and no other job", () => {
    landing();
    const d = deploy();
    const other = enqueue({ steps: ["implement"] });
    const holds = deployLandingHolds(ctx());
    expect(holds.get(d.id)?.inner).toEqual([{ key: "runner.landingRunning", values: { doing: "analyze", spec: "aide:91" } }]);
    expect(holds.has(other.id)).toBe(false);
  });

  test("with no landing the deploy is not held", () => {
    const d = deploy();
    expect(deployLandingHolds(ctx()).has(d.id)).toBe(false);
  });

  test("a tick leaves it queued with the sentence on the row, and starts it once the landing has cleared", () => {
    const l = landing();
    const d = deploy();
    const runner = makeRunner({ maxConcurrent: 3 });
    runner.tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
    expect(store.get(d.id)?.state).toBe("queued");
    expect(store.get(d.id)?.errorReason).toBe("held-back");
    expect(formatSentence("en", store.get(d.id)?.error)).toContain("aide:91");
    expect(spawns.map((s) => s.step)).not.toContain("deploy");

    store.update(l.id, { landing: undefined });
    runner.tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
    expect(store.get(d.id)?.state).toBe("running");
    expect(store.get(d.id)?.error).toBeUndefined();
    expect(spawns.map((s) => s.step)).toContain("deploy");
  });

  test("with no landing in flight the next tick starts the deploy at once", () => {
    const d = deploy();
    makeRunner().tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
    expect(store.get(d.id)?.state).toBe("running");
    expect(spawns).toHaveLength(1);
  });
});

test("a merge admitted after enqueue still finishes before Deploy starts (AC-6)", () => {
  const d = deploy();
  const active = landing();
  store.update(d.id, { deployWaitForLandings: [] });
  const runner = makeRunner();
  runner.tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
  expect(store.get(d.id)?.state).toBe("queued");
  store.update(active.id, { landing: false });
  runner.tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
  expect(store.get(d.id)?.state).toBe("running");
});

test("enqueuing Deploy does not capture landing priority (AC-1)", () => {
  landing();
  const d = deploy();
  expect(store.get(d.id)?.deployWaitForLandings).toBeUndefined();
});

test("a Merge that has started but not reached its repository yet holds a queued Deploy", () => {
  const merge = enqueue({ specFolder: "land", steps: ["land"], branch: "topic" } as never);
  store.update(merge.id, { state: "running", landing: true });
  const d = deploy();
  const runner = makeRunner();
  runner.tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
  expect(store.get(d.id)?.state).toBe("queued");
  store.update(merge.id, { landing: undefined, state: "done" });
  runner.tick({ deployWaitsForLanding: deployLandingHolds(ctx()) });
  expect(store.get(d.id)?.state).toBe("running");
});
