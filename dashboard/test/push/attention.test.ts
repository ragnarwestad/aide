// Who needs a person, decided from a real store's own changes: the
// observer sits on `onChange` exactly as `serve.ts` wires it, and every
// case is a transition the queue really makes (AC-2, AC-5).
import { afterEach, describe, expect, test } from "bun:test";
import { attentionFor, messageKeyFor } from "../../src/push/attention.ts";
import { createPush } from "../../src/push";
import type { ScheduleNotify } from "../../src/queue/schedule.ts";
import { endUntickedArchive } from "../../src/queue/runner/unticked-archive.ts";
import type { Job } from "../../src/queue/queue.ts";
import { fakeFetch, makeStore, result, runningJob, subscribeBody, tempDir } from "./fixtures.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** A store with the observer on its change hook and one subscribed device. */
async function board() {
  const tmp = tempDir();
  cleanups.push(tmp.done);
  const sent = fakeFetch();
  let push!: ReturnType<typeof createPush>;
  const store = makeStore(() => push.observe());
  push = createPush({ jobs: () => store.list(), fetch: sent.fetch });
  await push.subscribe(await subscribeBody(), "https://board.test");
  return { store, push, sent };
}

const now = () => new Date().toISOString();

describe("a spec that needs a person sends one push", () => {
  test("a step that fails (criterion 6)", async () => {
    const { store, push, sent } = await board();
    const job = runningJob(store);
    store.transition(job.id, "step-failed", { results: [result("implement", "error", false)] });
    await push.idle();
    expect(sent.calls).toHaveLength(1);
  });

  test("a step stopped by its time limit or the AI's usage limit (criterion 6)", async () => {
    const { store, push, sent } = await board();
    const a = runningJob(store, ["implement"]);
    store.transition(a.id, "run-stopped", { stopReason: "timeout", results: [result("implement", "timeout", false)] });
    const b = runningJob(store, ["analyze"], "82-another-spec");
    store.transition(b.id, "run-stopped", { stopReason: "provider-limit", results: [result("analyze", "provider-limit", false)] });
    await push.idle();
    expect(sent.calls).toHaveLength(2);
  });

  test("a step whose process vanished or was cut off by a restart (criterion 6)", async () => {
    const { store, push, sent } = await board();
    const job = runningJob(store);
    store.transition(job.id, "process-gone", { finishedAt: now() });
    await push.idle();
    expect(sent.calls).toHaveLength(1);
  });

  test("a merge that did not finish, or whose tests went red (criterion 7)", async () => {
    const { store, push, sent } = await board();
    const a = runningJob(store);
    store.transition(a.id, "step-succeeded-last", { results: [result("implement")] });
    await push.idle();
    expect(sent.calls).toHaveLength(0); // the step itself succeeded
    store.transition(a.id, "landing-failed", {});
    await push.idle();
    expect(sent.calls).toHaveLength(1);

    const b = runningJob(store, ["implement"], "82-another-spec");
    store.transition(b.id, "step-succeeded-last", { results: [result("implement")] });
    store.transition(b.id, "landing-held", { stopReason: "tests-red" });
    await push.idle();
    expect(sent.calls).toHaveLength(2);
  });

  test("an archive refused for unticked criteria, by a running step or by tick() (criterion 8)", async () => {
    const { store, push, sent } = await board();
    const a = runningJob(store, ["archive"]);
    store.transition(a.id, "step-succeeded-last", { results: [result("archive", "acceptance-criteria-unticked")] });
    await push.idle();
    expect(sent.calls).toHaveLength(1);

    const made = store.enqueue({ project: "aide", specFolder: "82-another-spec", steps: ["archive"] });
    if (!made.ok) throw new Error(made.error);
    endUntickedArchive(store, made.job, now());
    await push.idle();
    expect(sent.calls).toHaveLength(2);
  });
});

describe("a spec that moves on without waiting sends nothing (criterion 11)", () => {
  test("a step that succeeds and goes on, an archive that merges, a cancel, an update of a failed job", async () => {
    const { store, push, sent } = await board();
    const next = runningJob(store, ["analyze", "implement"]);
    store.transition(next.id, "step-succeeded", { stepIndex: 1, results: [result("analyze")] });

    const merged = runningJob(store, ["archive"], "82-another-spec");
    store.transition(merged.id, "step-succeeded-last", { results: [result("archive", "completed")] });

    const cancelled = runningJob(store, ["analyze"], "82-another-spec");
    store.transition(cancelled.id, "cancel", { finishedAt: now() });
    await push.idle();
    expect(sent.calls).toHaveLength(0);

    const failing = runningJob(store, ["implement"], "82-another-spec");
    store.transition(failing.id, "step-failed", { results: [result("implement", "error", false)] });
    store.update(failing.id, { spentUsd: 3 });
    store.update(failing.id, { spentUsd: 4 });
    await push.idle();
    expect(sent.calls).toHaveLength(1);
  });

  test("a create that failed says so once; a job that is neither a spec nor a real scheduled run says nothing (AC-6, AC-7)", () => {
    const failed = (specFolder: string) =>
      ({ state: "failed", specFolder, steps: ["create"], stepIndex: 0, results: [] }) as unknown as Job;
    const running = { state: "running", results: 0 } as const;
    expect(attentionFor(running, failed("new-abc123de"))?.kind).toBe("create-failed");
    expect(attentionFor({ ...running, createFailed: true }, failed("new-abc123de"))).toBeNull();
    expect(attentionFor(running, failed("schedule-weekly"))).toBeNull();
    expect(attentionFor(running, failed(SPEC_FOLDER))).not.toBeNull();
  });
});

const SPEC_FOLDER = "81-queue-and-runner";

describe("what a spec is waiting for picks the sentence (criterion 9)", () => {
  const job = (over: Record<string, unknown>) =>
    ({ specFolder: SPEC_FOLDER, steps: ["implement"], stepIndex: 0, results: [], ...over }) as unknown as Job;
  const key = (j: Job, prev = { state: "running", results: 0 } as const) => {
    const a = attentionFor(prev, j);
    return a && messageKeyFor(a);
  };

  test("each waiting state and stop reason has its own key", () => {
    expect(key(job({ state: "failed" }))).toBe("push.failed");
    expect(key(job({ state: "interrupted" }))).toBe("push.interrupted");
    expect(key(job({ state: "stopped", stopReason: "timeout" }))).toBe("push.stoppedTimeout");
    expect(key(job({ state: "stopped", stopReason: "provider-limit" }))).toBe("push.stoppedProviderLimit");
    expect(key(job({ state: "stopped", stopReason: "tests-red" }))).toBe("push.stoppedTestsRed");
    expect(key(job({ state: "done", results: [result("archive", "acceptance-criteria-unticked")] }))).toBe(
      "push.archiveHeldBack",
    );
  });

  test("the step named is the one that ran", () => {
    const a = attentionFor({ state: "running", results: 0 }, job({ state: "failed", results: [result("analyze", "error", false)] }));
    expect(a?.step).toBe("analyze");
    const b = attentionFor({ state: "running", results: 0 }, job({ state: "interrupted", steps: ["analyze", "implement"], stepIndex: 1 }));
    expect(b?.step).toBe("implement");
  });
});

describe("a scheduled run notifies by its entry's own choice", () => {
  const KEY = "schedule-nightly";
  /** A board whose lookup answers `choice` for the one entry, and counts its calls. */
  async function scheduled(choice: ScheduleNotify | null) {
    const tmp = tempDir();
    cleanups.push(tmp.done);
    const sent = fakeFetch();
    let push!: ReturnType<typeof createPush>;
    const store = makeStore(() => push.observe());
    const asked: string[] = [];
    push = createPush({
      jobs: () => store.list(),
      fetch: sent.fetch,
      scheduleNotify: (project, key) => {
        asked.push(`${project}/${key}`);
        return key === KEY ? choice : null;
      },
    });
    await push.subscribe(await subscribeBody(), "https://board.test");
    const run = (specFolder = KEY) => runningJob(store, ["schedule"], specFolder);
    return { store, push, sent, asked, run };
  }
  const ENDINGS = [
    ["done", (b: Awaited<ReturnType<typeof scheduled>>, id: string) => b.store.transition(id, "step-succeeded-last", { results: [result("schedule")] })],
    ["failed", (b: Awaited<ReturnType<typeof scheduled>>, id: string) => b.store.transition(id, "step-failed", { results: [result("schedule", "error", false)] })],
    ["stopped", (b: Awaited<ReturnType<typeof scheduled>>, id: string) => b.store.transition(id, "run-stopped", { stopReason: "timeout", results: [result("schedule", "timeout", false)] })],
    ["interrupted", (b: Awaited<ReturnType<typeof scheduled>>, id: string) => b.store.transition(id, "process-gone", { finishedAt: now() })],
  ] as const;
  // How many of the four endings each choice sends for.
  const WANT: Record<ScheduleNotify, Record<string, number>> = {
    always: { done: 1, failed: 1, stopped: 1, interrupted: 1 },
    failure: { done: 0, failed: 1, stopped: 1, interrupted: 1 },
    never: { done: 0, failed: 0, stopped: 0, interrupted: 0 },
  };
  for (const choice of ["always", "failure", "never"] as const) {
    for (const [ending, end] of ENDINGS) {
      test(`${choice}: a run that ends ${ending} sends ${WANT[choice][ending]} (AC-8)`, async () => {
        const b = await scheduled(choice);
        end(b, b.run().id);
        await b.push.idle();
        expect(b.sent.calls).toHaveLength(WANT[choice][ending]!);
      });
    }
  }

  test("a run a person cancels sends none, whatever the choice (AC-8)", async () => {
    const b = await scheduled("always");
    b.store.transition(b.run().id, "cancel", { finishedAt: now() });
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(0);
  });

  test("one push per ending: a cost update afterwards sends no second, and the lookup is asked once (AC-8)", async () => {
    const b = await scheduled("always");
    const job = b.run();
    expect(b.asked).toHaveLength(0);
    b.store.transition(job.id, "step-failed", { results: [result("schedule", "error", false)] });
    b.store.update(job.id, { spentUsd: 1 });
    b.store.update(job.id, { spentUsd: 2 });
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(1);
    expect(b.asked).toEqual([`aide/${KEY}`]);
  });

  test("an entry that has been deleted sends none (AC-8)", async () => {
    const b = await scheduled(null);
    b.store.transition(b.run().id, "step-failed", { results: [result("schedule", "error", false)] });
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(0);
  });

  test("an observer given no lookup sends none for a scheduled run (AC-8)", () => {
    const job = { state: "failed", specFolder: KEY, steps: ["schedule"], stepIndex: 0, results: [] } as unknown as Job;
    expect(attentionFor({ state: "running", results: 0 }, job)).toBeNull();
    expect(attentionFor({ state: "running", results: 0 }, job, () => "always")?.kind).toBe("schedule-run");
  });

  test("a spec's own notifications do not move, and the lookup is never asked for one (AC-10)", async () => {
    const b = await scheduled("always");
    const asked = () => b.asked.length;
    const fails = runningJob(b.store, ["implement"], "82-another-spec");
    b.store.transition(fails.id, "step-failed", { results: [result("implement", "error", false)] });
    const moves = runningJob(b.store, ["analyze"], SPEC_FOLDER);
    b.store.transition(moves.id, "step-succeeded-last", { results: [result("analyze")] });
    const cancelled = runningJob(b.store, ["analyze"], "82-another-spec");
    b.store.transition(cancelled.id, "cancel", { finishedAt: now() });
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(1);
    expect(asked()).toBe(0);
  });
});
