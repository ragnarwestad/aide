// What of a project's work is still going, and the timed wait for it to
// end: the test board's round reads both before it resets its
// repositories and before it calls itself done.
import { describe, expect, test } from "bun:test";
import { unfinishedWork, waitUntilEnded } from "../../../src/queue/job-rules/work-ended.ts";
import { inFlight, writing } from "../../../src/queue/job-rules/activity.ts";

const job = (specFolder: string, state: string, extra: { project?: string; landing?: boolean } = {}) => ({
  project: extra.project ?? "aide-test",
  specFolder,
  state,
  landing: extra.landing,
});

describe("unfinishedWork", () => {
  test("names a process group that is still alive, and nothing once it has exited (AC-1)", () => {
    const alive = new Set([4242]);
    const left = () => unfinishedWork([job("01-a", "cancelled")], "aide-test", [4242], (g) => alive.has(g), writing);
    expect(left()).toEqual(["process group 4242"]);
    alive.delete(4242);
    expect(left()).toEqual([]);
  });

  test("names a job of the project whose landing still runs, whatever its state, and no other project's (AC-1)", () => {
    const jobs = [
      job("01-a", "cancelled", { landing: true }),
      job("02-b", "done", { landing: true }),
      job("03-c", "done"),
      job("81-other", "running", { project: "aide", landing: true }),
    ];
    expect(unfinishedWork(jobs, "aide-test", [], () => false, writing)).toEqual([
      "01-a (landing)",
      "02-b (landing)",
    ]);
  });

  test("a queued job is going for the round's own wait, not for the cancel wait (AC-1)", () => {
    const jobs = [job("01-a", "queued")];
    expect(unfinishedWork(jobs, "aide-test", [], () => false, inFlight)).toEqual(["01-a (queued)"]);
    expect(unfinishedWork(jobs, "aide-test", [], () => false, writing)).toEqual([]);
  });
});

describe("waitUntilEnded", () => {
  /** A clock that moves only when the wait sleeps. */
  function clock() {
    let t = 0;
    const slept: number[] = [];
    return {
      now: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
      slept,
    };
  }

  test("rejects when the time runs out, naming what it waited on and everything still going (AC-2)", async () => {
    const c = clock();
    const wait = waitUntilEnded(() => ["01-a (landing)", "process group 4242"], 2000, "the cancelled work", {
      pollMs: 250,
      sleep: c.sleep,
      now: c.now,
    });
    await expect(wait).rejects.toThrow(/^the cancelled work had not ended after 2 seconds: 01-a \(landing\), process group 4242$/);
  });

  test("resolves at once, without sleeping, when nothing is left (AC-4)", async () => {
    const c = clock();
    await waitUntilEnded(() => [], 1000, "the cancelled work", { sleep: c.sleep, now: c.now });
    expect(c.slept).toEqual([]);
  });

  test("resolves once the work ends within the limit, running `between` after each wait (AC-4)", async () => {
    const c = clock();
    let left = 3;
    let between = 0;
    await waitUntilEnded(() => (left-- > 0 ? ["01-a (running)"] : []), 10_000, "the round's work", {
      pollMs: 100,
      sleep: c.sleep,
      now: c.now,
      between: async () => {
        between += 1;
      },
    });
    expect(c.slept).toEqual([100, 100, 100]);
    expect(between).toBe(3);
  });
});
