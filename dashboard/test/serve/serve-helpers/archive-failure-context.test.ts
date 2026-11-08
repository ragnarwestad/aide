import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQueueRunner, type RunnerSetupContext } from "../../../src/serve/runner-setup.ts";
import { QueueStore, type Job } from "../../../src/queue/queue.ts";
import { archiveFailureContext, previousAttemptContext } from "../../../src/serve/serve-helpers/runner-argv.ts";

let killSpy: ReturnType<typeof spyOn>;
beforeEach(() => { killSpy = spyOn(process, "kill").mockReturnValue(true); });
afterEach(() => killSpy.mockRestore());

const current = { id: "new", project: "aide", specFolder: "81-example" } as Job;
const failed = {
  ...current, id: "old", state: "stopped", errorReason: "tests-red",
  branchUrls: [{ root: "/code", url: "https://example.test/compare/main...aide/81-example" }], finishedAt: "2026-11-07T10:00:00Z",
  landingError: "named-test failed",
  landingErrorDetail: "TypeError: root.querySelector is not a function",
  results: [{ step: "archive", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", at: "2026-11-07T09:00:00Z",
    repos: [{ root: "/code", headBefore: "before", headAfter: "branch-tip" }] }],
} as Job;

test("serializes first-attempt evidence only when the retry record has it (AC-11)", () => {
  expect(previousAttemptContext(current)).toBeUndefined();
  const evidence = {
    terminalReason: "no-progress",
    detail: "nothing changed",
    repos: [{ root: "/code", headBefore: "before", headAfter: "after" }],
  };
  const retrying = { ...current, retry: { action: "implement", attempts: 2, previousAttempt: evidence } } as Job;
  expect(JSON.parse(previousAttemptContext(retrying)!)).toEqual(evidence);
});

test("passes the Archive evidence and branch revisions to the next Implement", () => {
  const context = JSON.parse(archiveFailureContext(current, [failed]) ?? "null");
  expect(context).toEqual({
    jobId: "old", at: "2026-11-07T09:00:00Z", branchUrls: [{ root: "/code", url: "https://example.test/compare/main...aide/81-example" }],
    failure: "named-test failed", detail: "TypeError: root.querySelector is not a function",
    archiveStepRepos: [{ root: "/code", headBefore: "before", headAfter: "branch-tip" }],
  });
});

test("keeps the recorded Archive failure when starting the same job clears its current error", () => {
  const source = { ...failed, errorReason: undefined,
    landingError: { key: "landing.stepStopped", values: { step: "archive" },
      inner: { key: "landing.testsRedOnMerge", values: { tests: "named-test", branch: "aide/81-example", button: "Archive" } } },
  } as Job;
  expect(JSON.parse(archiveFailureContext(current, [source]) ?? "null")?.detail)
    .toBe("TypeError: root.querySelector is not a function");
});

test("ignores other projects and specs", () => {
  expect(archiveFailureContext(current, [
    { ...failed, project: "other" }, { ...failed, specFolder: "82-other" },
  ])).toBeUndefined();
});

test("does not resurrect an older failure after a successful Archive", () => {
  const succeeded = { ...failed, id: "success", state: "done", errorReason: undefined,
    landingError: undefined, landingErrorDetail: undefined,
    results: [{ step: "archive", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", at: "2026-11-07T11:00:00Z" }],
  } as Job;
  expect(archiveFailureContext(current, [succeeded, failed])).toBeUndefined();
});

test("uses the latest Archive result, not the creation order of jobs", () => {
  const later = { ...failed, id: "later", landingErrorDetail: "latest failure",
    results: [{ ...failed.results[0]!, at: "2026-11-07T12:00:00Z" }],
  } as Job;
  expect(JSON.parse(archiveFailureContext(current, [later, failed])!)?.detail).toBe("latest failure");
});

test("does not pass conflicts or Implement-only failures as Archive test evidence", () => {
  expect(archiveFailureContext(current, [{ ...failed, errorReason: "conflict" }])).toBeUndefined();
  expect(archiveFailureContext(current, [{ ...failed, results: [
    { step: "implement", ok: false, costUsd: 0, costMeasured: true, terminalReason: "tests-red", at: "2026-11-07T12:00:00Z" },
  ] }])).toBeUndefined();
});


test.each(["implement", "analyze"] as const)("the board starts %s with the appropriate Archive evidence", (step) => {
  const dir = mkdtempSync(join(tmpdir(), "archive-context-"));
  const store = new QueueStore({ defaults: { timeoutSec: { default: 120 }, permissionMode: { default: "acceptEdits" }, model: {} }, resolve: () => ({ specFolders: [current.specFolder] }) });
  const made = store.enqueue({ project: current.project, specFolder: current.specFolder, steps: [step] });
  if (!made.ok) throw new Error(made.error);
  const list = spyOn(store, "list").mockImplementation(() => [made.job, { ...failed, steps: ["archive"], stepIndex: 0 }]);
  const spawn = spyOn(Bun, "spawn").mockReturnValue({ pid: 12345, unref() {} } as ReturnType<typeof Bun.spawn>);
  const ctx = {
    store, queueRunnerBin: "/bin/true", queueResultDir: dir,
    machineryProjectDir: () => dir, machinerySpecsRoot: () => undefined,
    readServerPort: () => 1234, codeLanding: () => "merge", specDir: () => undefined,
    promptFileFor: () => undefined, chromeFor: () => false, noSandboxFor: () => false,
  } as unknown as RunnerSetupContext;
  try {
    createQueueRunner(ctx)!.tick();
    const env = (spawn.mock.calls[0]![0] as unknown as { env: Record<string, string> }).env;
    if (step === "implement") expect(JSON.parse(env.AIDE_ARCHIVE_FAILURE_CONTEXT!).jobId).toBe("old");
    else expect(env.AIDE_ARCHIVE_FAILURE_CONTEXT).toBeUndefined();
  } finally {
    spawn.mockRestore();
    list.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});


test("uses Archive's current failure when an older landing error is also recorded", () => {
  const source = { ...failed, landingError: "old Analyze failure", landingErrorDetail: "old detail",
    error: "current Archive test failure", errorDetail: "current test output" };
  const context = JSON.parse(archiveFailureContext(current, [source])!);
  expect([context.failure, context.detail]).toEqual(["current Archive test failure", "current test output"]);
});


test("a later successful Analyze does not resolve the recorded Archive failure", () => {
  const source = { ...failed, state: "done", errorReason: undefined,
    landingError: { key: "landing.stepStopped", values: { step: "archive" },
      inner: { key: "landing.testsRedOnMerge", values: { tests: "named-test", branch: "aide/81-example", button: "Archive" } } },
    results: [...failed.results, { ...failed.results[0]!, step: "analyze", at: "2026-11-07T12:00:00Z" }],
  } as Job;
  expect(JSON.parse(archiveFailureContext(current, [source]) ?? "null")?.jobId).toBe("old");
});
