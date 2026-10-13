// A queued deploy waits while a landing is in flight, with the reason on its
// row, and starts on the first tick after the landing has settled.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderSentence } from "../../../src/i18n/message.ts";
import { fixedSentenceHolds, type ScheduleContext } from "../../../src/serve/schedules";
import { cleanupHarness, enqueue, makeRunner, resetHarness, spawns, store } from "../../queue/runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const deploy = () => enqueue({ specFolder: "deploy", steps: ["deploy"] });

/** The schedule's own context, as far as the fixed holds read it. */
const ctx = (): ScheduleContext => ({ queue: store }) as unknown as ScheduleContext;

/** A job whose step has ended and whose branch is being merged. */
function landing() {
  const job = enqueue({ specFolder: "91-parallel-spec-runs" });
  store.update(job.id, { landing: true });
  return job;
}

describe("a queued deploy is held back while a landing is in flight (AC-4)", () => {
  test("the holds name the deploy with the landing sentence, and no other job (AC-4)", () => {
    const d = deploy();
    const other = enqueue({ steps: ["implement"] });
    landing();
    const holds = fixedSentenceHolds(ctx());
    expect(holds.get(d.id)).toEqual({ key: "runner.landingPause" });
    expect(holds.has(other.id)).toBe(false);
  });

  test("with no landing the deploy is not held (AC-4)", () => {
    const d = deploy();
    expect(fixedSentenceHolds(ctx()).has(d.id)).toBe(false);
  });

  test("a tick leaves it queued with the sentence on the row, and starts it once the landing has cleared (AC-4)", () => {
    const d = deploy();
    const l = landing();
    const runner = makeRunner({ maxConcurrent: 3 });
    runner.tick(undefined, fixedSentenceHolds(ctx()));
    expect(store.get(d.id)?.state).toBe("queued");
    expect(store.get(d.id)?.errorReason).toBe("held-back");
    expect(renderSentence("en", store.get(d.id)?.error)).toContain("merge");
    expect(spawns.map((s) => s.step)).not.toContain("deploy");

    store.update(l.id, { landing: undefined });
    runner.tick(undefined, fixedSentenceHolds(ctx()));
    expect(store.get(d.id)?.state).toBe("running");
    expect(store.get(d.id)?.error).toBeUndefined();
    expect(spawns.map((s) => s.step)).toContain("deploy");
  });

  test("with no landing in flight the next tick starts the deploy at once (AC-4)", () => {
    const d = deploy();
    makeRunner().tick(undefined, fixedSentenceHolds(ctx()));
    expect(store.get(d.id)?.state).toBe("running");
    expect(spawns).toHaveLength(1);
  });
});
