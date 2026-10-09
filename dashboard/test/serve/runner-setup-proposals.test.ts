// The runner's step-done wiring: a scheduled run that ended green hands its
// proposals to the board, and nothing else does (spec proposals from a run).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type Job } from "../../src/queue/queue.ts";
import { PROPOSALS_FILE } from "../../src/queue/spec-proposals.ts";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";
import { stepDoneHandler } from "../../src/serve/runner-setup.ts";

let root: string;
let store: QueueStore;

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "run-1",
    project: "aide",
    specFolder: "schedule-nyhetssjekk",
    steps: ["schedule"],
    stepIndex: 0,
    state: "running",
    createdAt: "2026-09-26T18:00:00Z",
    results: [],
    spentUsd: 0,
    ...over,
  }) as Job;

const handler = () =>
  stepDoneHandler({
    store,
    scheduleOutputRoot: join(root, "out"),
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    machineryProjectDir: () => join(root, "code"),
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    landStepBranch: () => Promise.resolve(),
    landNewSpec: () => Promise.resolve(),
  } as unknown as Parameters<typeof stepDoneHandler>[0]);

const creates = () => store.list().filter((j) => j.steps[0] === "create");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aide-step-done-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  const dir = scheduleRunOutputDir(join(root, "out"), "aide", "schedule-nyhetssjekk", "run-1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PROPOSALS_FILE), JSON.stringify([{ title: "First", description: "d" }]));
  store = new QueueStore({
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: [] }),
    allowCreateProject: (p) => p === "aide",
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("stepDoneHandler and a scheduled run's proposals", () => {
  test("a schedule step that ended ok queues a Create job per proposal and returns no landing (AC-2)", () => {
    expect(handler()(job(), "schedule", { ok: true, terminalReason: "completed" })).toBeUndefined();
    expect(creates().map((j) => j.createTitle)).toEqual(["First"]);
  });

  test("a schedule step that did not end ok queues nothing (AC-4)", () => {
    handler()(job(), "schedule", { ok: false, terminalReason: "cli-error" });
    handler()(job(), "schedule", { ok: false, terminalReason: "scope-violation" });
    handler()(job(), "schedule", { ok: false, terminalReason: "timeout" });
    expect(creates()).toEqual([]);
  });

  test("an ok step of any other kind reads no proposals (AC-2)", () => {
    for (const step of ["analyze", "implement", "explore"] as const) {
      handler()(job({ steps: [step] }), step, { ok: true, terminalReason: "completed" });
    }
    expect(creates()).toEqual([]);
  });
});
