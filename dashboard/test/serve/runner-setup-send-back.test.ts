// An implement the runner ended `sent-back` is landed when it pushed only the
// specs repository, and the board then queues Analyze and Implement for the
// spec on the models it ran with. Any other ending queues nothing, and so does
// one the runner refused: the spec's analysis was already full.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { QueueStore, type Job } from "../../src/queue/queue.ts";
import { stepDoneHandler } from "../../src/serve/runner-setup.ts";
import { DEFAULTS, cleanupHarness, dir, makeRunner, okResult, resetHarness } from "../queue/runner/runner-fixtures.ts";

// The harness's own store offers no model choice, so a job cannot name a model on it.
let store: QueueStore;
beforeEach(() => {
  resetHarness();
  store = new QueueStore({
    mirrorPath: join(dir, "send-back-queue.json"),
    defaults: { ...DEFAULTS, modelChoices: { opus: {}, haiku: {} } },
    resolve: () => ({ specFolders: [SPEC] }),
  });
});
afterEach(cleanupHarness);

const WHY = "it changes the result format every page reads, in nine files";

const SPEC = "81-queue-and-runner";

let landed: string[];

/** The step-done hook as the server wires it, with the landing recorded and
 *  settled at once. */
const hook = () => {
  landed = [];
  return stepDoneHandler({
    store,
    machineryProjectDir: (project: string) => join(dir, project),
    machinerySpecsRoot: (project: string) => join(dir, project, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    landStoppedStepBranch: (job: Job, step: string) => {
      landed.push(`${job.id}:${step}`);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
};

const SPECS_ONLY = [{ root: join("specs-repo"), url: "https://example.test/specs" }];
const WITH_CODE = (): { root: string; url: string }[] => [...SPECS_ONLY, { root: join(dir, "aide"), url: "https://example.test/code" }];

/** An implement job (with an Archive behind it) whose step ends as `result` says. */
const endImplement = async (result: Record<string, unknown>) => {
  const job = enqueue(["implement", "archive"]);
  const runner = makeRunner({ store, onStepDone: hook(), readResult: () => ({ ...okResult(0.1), ok: false, ...result }) });
  runner.tick();
  runner.poll();
  // The round is queued on a timer, after the landing has settled.
  await new Promise((resolve) => setTimeout(resolve, 30));
  return job;
};

const enqueue = (steps: string[]): Job => {
  const made = store.enqueue({ project: "aide", specFolder: SPEC, steps, model: { implement: "opus", archive: "haiku" } });
  if (!made.ok) throw new Error(made.error);
  return made.job;
};

const others = (job: Job) => store.list().filter((j) => j.id !== job.id);

describe("an implement sent back to a full analysis", () => {
  test("is stopped, its specs branch is landed, and Analyze then Implement is queued on its models", async () => {
    const job = await endImplement({ terminalReason: "sent-back", error: WHY, branchUrls: SPECS_ONLY });
    expect(store.get(job.id)?.state).toBe("stopped");
    expect(store.get(job.id)?.stopReason).toBe("sent-back");
    expect(landed).toEqual([`${job.id}:implement`]);
    const [round, ...rest] = others(job);
    expect(rest).toEqual([]);
    expect([round?.project, round?.specFolder, round?.steps, round?.state]).toEqual(["aide", SPEC, ["analyze", "implement"], "queued"]);
    expect(round?.model?.implement).toBe("opus");
    expect(round?.model?.archive).toBeUndefined();
  });

  test("that also pushed the code repository lands nothing and still queues the round", async () => {
    const job = await endImplement({ terminalReason: "sent-back", error: WHY, branchUrls: WITH_CODE() });
    expect(landed).toEqual([]);
    expect(others(job).map((j) => j.steps)).toEqual([["analyze", "implement"]]);
  });

  for (const terminalReason of ["no-progress", "timeout", "tests-red", "short-analysis-over-limit"]) {
    test(`an implement that ends on ${terminalReason} queues nothing`, async () => {
      const job = await endImplement({ terminalReason, error: "x", branchUrls: SPECS_ONLY });
      expect(others(job)).toEqual([]);
    });
  }

  test("a sent-back step of another kind than implement queues nothing", async () => {
    const job = enqueue(["analyze"]);
    const runner = makeRunner({ store, onStepDone: hook(), readResult: () => ({ ...okResult(0.1), ok: false, terminalReason: "sent-back" }) });
    runner.tick();
    runner.poll();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(others(job)).toEqual([]);
  });
});

describe("an implement the runner refused to send back, its analysis being full", () => {
  test("fails, lands nothing and queues nothing", async () => {
    const job = await endImplement({ terminalReason: "sent-back-refused", error: "refused", branchUrls: SPECS_ONLY });
    expect(store.get(job.id)?.state).toBe("failed");
    expect(landed).toEqual([]);
    expect(others(job)).toEqual([]);
  });
});
