// A queued `archive` whose acceptance rows are still open is one
// `aide-archive-spec` would only refuse. The runner ends it on the spot
// with that same refusal, rather than holding it behind another archive
// with two reasons on one row (490, 2026-09-18) — and never starts it
// by itself once the rows are ticked: a person presses Archive.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHarness, enqueue, makeRunner, resetHarness, spawns, store } from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

describe("an archive whose acceptance rows are open", () => {
  test("ends done with the acceptance refusal, without being started", () => {
    const job = enqueue({ steps: ["archive"] });
    makeRunner({}).tick(undefined, undefined, new Set([job.id]));
    const after = store.get(job.id)!;
    expect(spawns).toHaveLength(0);
    expect(after.state).toBe("done");
    expect(after.errorReason).toBeUndefined();
    expect(after.results.at(-1)).toMatchObject({
      step: "archive", ok: true, costUsd: 0, terminalReason: "acceptance-criteria-unticked",
    });
  });

  test("is ended even while another archive runs in the project, so no hold is written", () => {
    const other = enqueue({ specFolder: "91-parallel-spec-runs", steps: ["archive"] });
    const runner = makeRunner({});
    runner.tick();
    expect(store.get(other.id)?.state).toBe("running");
    const job = enqueue({ steps: ["archive"] });
    runner.tick(undefined, undefined, new Set([job.id]));
    expect(store.get(job.id)?.state).toBe("done");
    expect(store.get(job.id)?.error).toBeUndefined();
  });

  test("a chained job ends after the steps it did run, keeping their results", () => {
    const job = enqueue({ steps: ["implement", "archive"] });
    store.update(job.id, {
      stepIndex: 1,
      results: [{ step: "implement", ok: true, costUsd: 1, costMeasured: true, terminalReason: "completed" }],
    });
    makeRunner({}).tick(undefined, undefined, new Set([job.id]));
    const after = store.get(job.id)!;
    expect(after.state).toBe("done");
    expect(after.results.map((r) => r.step)).toEqual(["implement", "archive"]);
  });

  test("an archive not in the set starts as before", () => {
    const job = enqueue({ steps: ["archive"] });
    makeRunner({}).tick(undefined, undefined, new Set());
    expect(store.get(job.id)?.state).toBe("running");
  });
});
