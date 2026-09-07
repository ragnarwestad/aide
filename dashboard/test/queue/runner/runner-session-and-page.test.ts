// Split out of runner.test.ts by theme.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawns, store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

// Criteria 3 and 10 (spec 02): the queue used to learn the session id
// from the result file — by which time the step was over and there was
// nothing left to watch. Generating it BEFORE the spawn is what turns
// "$0 and nothing" into a session the live panel can follow.
describe("the session id is known before the step starts", () => {
  test("tick() hands the spawner a session id and a stream file, and stores both on the job", () => {
    const job = enqueue();
    const runner = makeRunner({ newSessionId: () => "11111111-2222-4333-8444-555555555555" });
    runner.tick();

    expect(spawns[0]!.sessionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(spawns[0]!.streamFile).toContain(job.id);
    const stored = store.get(job.id)!;
    expect(stored.state).toBe("running");
    expect(stored.sessionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(stored.streamFile).toBe(spawns[0]!.streamFile);
  });

  test("the id is stored before any result could have arrived", () => {
    // readResult never answers, so nothing has completed: whatever the
    // job carries now was known in advance, not learned afterwards.
    const job = enqueue();
    makeRunner({ readResult: () => null }).tick();
    expect(store.get(job.id)!.results).toEqual([]);
    expect(store.get(job.id)!.sessionId).toBeTruthy();
  });

  test("every step gets its own session id", () => {
    enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    runner.tick();
    expect(spawns).toHaveLength(2);
    expect(spawns[0]!.sessionId).not.toBe(spawns[1]!.sessionId);
  });

  test("complete() clears the live id and records it on the finished step", () => {
    const job = enqueue();
    const runner = makeRunner({
      newSessionId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      readResult: () => okResult(1),
    });
    runner.tick();
    const streamFile = store.get(job.id)!.streamFile;
    runner.poll();

    const done = store.get(job.id)!;
    expect(done.state).toBe("done");
    // A finished job that still advertises a live session is a lie the
    // page would render as "running somewhere".
    expect(done.sessionId).toBeUndefined();
    expect(done.results[0]!.sessionId).toBe("s1");
    expect(done.results[0]!.streamFile).toBe(streamFile);
  });

  test("a result that reports no session falls back to the id we supplied", () => {
    const job = enqueue();
    const { sessionId: _drop, ...noSession } = okResult(1);
    const runner = makeRunner({
      newSessionId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      readResult: () => noSession,
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)!.results[0]!.sessionId).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  test("an interrupted step clears the live id too", () => {
    const job = enqueue();
    const runner = makeRunner({ alive: () => false, readResult: () => null });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)!.state).toBe("interrupted");
    expect(store.get(job.id)!.sessionId).toBeUndefined();
  });
});

describe("what the page needs from a step", () => {
  test("the branch link from the result is kept on the job", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({ ...okResult(1), branchUrl: "https://example.test/compare" }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.branchUrl).toBe("https://example.test/compare");
  });

  // Spec 89: `aide-run-spec` reports one entry per repo it pushed, and
  // the runner read only the singular neighbour. A job that touches two
  // repos makes two branches, and one link for both was the whole bug.
  test("every repo the step pushed to is kept, not just the representative one", () => {
    const job = enqueue();
    const runner = makeRunner({
      readResult: () => ({
        ...okResult(1),
        branchUrl: "https://example.test/aide/compare",
        branchUrls: [
          { root: "/repos/aide", url: "https://example.test/aide/compare" },
          { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
        ],
      }),
    });
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.branchUrls).toEqual([
      { root: "/repos/aide", url: "https://example.test/aide/compare" },
      { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
    ]);
  });

  // An analyze step changes only the specs repo; the implement step
  // after it changes both. Replacing the list wholesale would make the
  // project's branch vanish from a spec that has one.
  test("a later step touching fewer repos does not erase the earlier ones", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    let call = 0;
    const runner = makeRunner({
      readResult: () => {
        call += 1;
        return call === 1
          ? {
              ...okResult(1),
              branchUrls: [
                { root: "/repos/aide", url: "https://example.test/aide/old" },
                { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
              ],
            }
          : {
              ...okResult(1),
              branchUrls: [{ root: "/repos/aide", url: "https://example.test/aide/new" }],
            };
      },
    });
    runner.tick();
    runner.poll(); // analyze lands
    runner.tick();
    runner.poll(); // implement lands
    expect(store.get(job.id)?.branchUrls).toEqual([
      // The root both steps touched carries the LATEST url…
      { root: "/repos/aide", url: "https://example.test/aide/new" },
      // …and the one only the first step touched is still there.
      { root: "/repos/aide-specs", url: "https://example.test/aide-specs/compare" },
    ]);
  });

  test("a step that pushed nowhere leaves what earlier steps recorded", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    let call = 0;
    const runner = makeRunner({
      readResult: () => {
        call += 1;
        return call === 1
          ? { ...okResult(1), branchUrls: [{ root: "/repos/aide", url: "https://example.test/aide" }] }
          : okResult(1);
      },
    });
    runner.tick();
    runner.poll();
    runner.tick();
    runner.poll();
    expect(store.get(job.id)?.branchUrls).toEqual([
      { root: "/repos/aide", url: "https://example.test/aide" },
    ]);
  });
});

// One transcript per STEP, not per job. `StepResult.streamFile` is
// recorded per step so a finished step stays readable after the next one
// has started — but every step wrote the SAME file, so the next step
// overwrote the transcript that pointer names. A three-step job kept
// only its last step's log, and the one you want when a job took an
// hour is implement's: always the one gone.
describe("each step keeps its own transcript", () => {
  test("two steps of one job are handed two different files, each naming its step", () => {
    enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    runner.tick();
    expect(spawns).toHaveLength(2);
    expect(spawns[0]!.streamFile).not.toBe(spawns[1]!.streamFile);
    expect(spawns[0]!.streamFile).toContain("analyze");
    expect(spawns[1]!.streamFile).toContain("implement");
  });

  // The job's own pointer still moves to the running step — that is what
  // the live panel follows — so the per-step record is the only thing
  // that keeps an earlier step readable.
  test("the finished step's own result keeps pointing at its own file", () => {
    const job = enqueue({ steps: ["analyze", "implement"] });
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    runner.tick();
    const stored = store.get(job.id)!;
    expect(stored.results?.[0]?.streamFile).toContain("analyze");
    expect(stored.results?.[0]?.streamFile).not.toBe(stored.streamFile);
  });
});
