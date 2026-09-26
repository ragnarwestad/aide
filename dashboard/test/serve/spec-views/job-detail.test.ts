// `jobDetailView` is where each finished step's own transcript
// (`r.streamFile`) and commit range (`r.repos`) become the Logs tab's
// content: the log parts (Aide's lines and the AI's, from the run log beside
// the transcript), the error lines, and which files the step's commit touched.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { jobDetailView } from "../../../src/serve/spec-views";
import { aiLabel } from "../../../src/serve/spec-views/job-detail.ts";
import type { SpecViewsContext } from "../../../src/serve/spec-views";
import type { Job } from "../../../src/queue/queue.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
function tempStreamFile(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "job-detail-test-"));
  dirs.push(dir);
  const file = join(dir, "job.stream.jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}
/** The step's run log, beside its transcript where the runner keeps it. */
function withRunLog(streamFile: string, lines: string[]): string {
  writeFileSync(streamFile.replace(/\.stream\.jsonl$/, ".run.log"), lines.join("\n") + "\n");
  return streamFile;
}
afterEach(() => {
  // The stream files are plain temp dirs with one file each — nothing
  // this suite writes needs to survive past its own run.
  dirs.length = 0;
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    project: "aide",
    specFolder: "452-x",
    steps: ["implement"],
    stepIndex: 0,
    state: "done",
    timeoutSec: {},
    permissionMode: {},
    model: {},
    createdAt: "2026-09-13T10:00:00Z",
    results: [],
    spentUsd: 0,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SpecViewsContext> = {}): SpecViewsContext {
  return {
    projectRoot: "/repos/aide",
    targets: () => [],
    peekUnlanded: () => [],
    peekUnlandedCheckedAt: () => null,
    readPrOpen: () => [],
    readScan: () => null,
    queue: { defaults: {} } as never,
    specDir: () => undefined,
    specRef: () => undefined,
    peekMachinerySpecDir: (_p, dir) => dir,
    machinerySpecDir: async (_p, dir) => dir,
    dependencyFolders: () => [],
    gitRun: fakeGit({}).run,
    withFreshness: (list) => list,
    jobRow: async (job) => ({ ...job }) as never,
    specFileCommits: {} as never,
    branchStatus: {} as never,
    specsRoot: async (dir) => dir,
    specCreatedAt: {} as never,
    pdfToolAvailable: false,
    testServers: {} as never,
    ...overrides,
  };
}

describe("jobDetailView's per-step fields", () => {
  test("populates logs/errors/changedFiles from the step's own streamFile and repos", async () => {
    const streamFile = tempStreamFile([
      { type: "assistant", timestamp: "2026-09-13T10:00:00.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test" } }] } },
      { type: "user", timestamp: "2026-09-13T10:00:01.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } },
      { type: "result", subtype: "success", result: "All done." },
    ]);
    const { run } = fakeGit({
      "diff --numstat": { code: 0, stdout: "4\t1\tsrc/queue/runner.ts\n" },
    });
    const job = makeJob({
      results: [
        {
          step: "implement", ok: true, costUsd: 1, costMeasured: true, terminalReason: "completed",
          streamFile, tool: "claude",
          repos: [{ root: "/repos/aide", headBefore: "sha1", headAfter: "sha2" }],
        },
      ],
    });

    const view = await jobDetailView(makeCtx({ gitRun: run }), job);

    expect(view.results).toHaveLength(1);
    expect(view.results[0]!.logs).toEqual([{ by: "ai", lines: ["Bash bun test", "All done."] }]);
    expect(view.results[0]!.errors).toEqual([]);
    expect("finalMessage" in view.results[0]!).toBe(false);
    expect("commands" in view.results[0]!).toBe(false);
    expect(view.results[0]!.changedFiles).toEqual([{ path: "src/queue/runner.ts", added: 4, removed: 1, binary: false }]);
  });

  test("a result with no streamFile leaves logs/errors/changedFiles undefined", async () => {
    const job = makeJob({
      results: [{ step: "implement", ok: true, costUsd: 1, costMeasured: true, terminalReason: "completed" }],
    });

    const view = await jobDetailView(makeCtx(), job);

    expect(view.results[0]!.logs).toBeUndefined();
    expect(view.results[0]!.errors).toBeUndefined();
    expect(view.results[0]!.changedFiles).toBeUndefined();
  });

  test("repos with headBefore === headAfter yields an empty changedFiles, not undefined", async () => {
    const streamFile = tempStreamFile([{ type: "result", subtype: "success", result: "nothing to do" }]);
    const { run, calls } = fakeGit({ "diff --numstat": { code: 0, stdout: "1\t1\tx.ts\n" } });
    const job = makeJob({
      results: [
        {
          step: "implement", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed",
          streamFile, tool: "claude",
          repos: [{ root: "/repos/aide", headBefore: "sameSha", headAfter: "sameSha" }],
        },
      ],
    });

    const view = await jobDetailView(makeCtx({ gitRun: run }), job);

    expect(view.results[0]!.changedFiles).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("jobDetailView's log and error lines", () => {
  const twoCommands = (message: string, tail: unknown[] = []) => [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "git status" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: false }] } },
    ...tail,
    { type: "result", subtype: "success", result: message },
  ];
  const finished = (streamFile: string) =>
    makeJob({
      results: [{ step: "implement", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile, tool: "claude" }],
    });

  test("errors holds the failed command and the log holds both, in one ai part (AC-7)", async () => {
    const view = await jobDetailView(makeCtx(), finished(tempStreamFile(twoCommands("Done."))));

    expect(view.results[0]!.errors).toEqual(["Bash bun test"]);
    expect(view.results[0]!.logs).toEqual([{ by: "ai", lines: ["Bash bun test", "Bash git status", "Done."] }]);
  });

  test("the log ends with the whole final message once, when the last line only repeats it (AC-5)", async () => {
    const said = { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } };
    const view = await jobDetailView(makeCtx(), finished(tempStreamFile(twoCommands("Done.", [said]))));

    expect(view.results[0]!.logs![0]!.lines).toEqual(["Bash bun test", "Bash git status", "Done."]);
  });

  test("the parts come from a real transcript and the run log beside it, and Aide's error line is in errors (AC-3)", async () => {
    const stream = withRunLog(tempStreamFile(twoCommands("Done.")), [
      "aide-run-spec 10:45:08 +0s fetching main",
      "aide-run-spec 10:45:09 +1s model turn started (transcript at byte 0)",
      "aide-run-spec 10:52:13 +427s error: the tests are red — handing them back",
    ]);
    const view = await jobDetailView(makeCtx(), finished(stream));

    expect(view.results[0]!.logs!.map((p) => p.by)).toEqual(["aide-before", "ai", "aide-after"]);
    expect(view.results[0]!.errors).toEqual(["Bash bun test", "10:52:13 +427s error: the tests are red — handing them back"]);
  });

  test("the running step carries its parts, its error lines and no final message (AC-3)", async () => {
    const stream = withRunLog(tempStreamFile(twoCommands("x").slice(0, 4)), [
      "aide-run-spec 10:45:08 +0s fetching main",
      "aide-run-spec 10:45:09 +1s model turn started (transcript at byte 0)",
    ]);
    const view = await jobDetailView(makeCtx(), makeJob({ state: "running", streamFile: stream }));

    expect(view.runningStep!.logs).toEqual([
      { by: "aide-before", lines: ["10:45:08 +0s fetching main"] },
      { by: "ai", lines: ["Bash bun test", "Bash git status"] },
    ]);
    expect(view.runningStep!.errors).toEqual(["Bash bun test"]);
  });

  test("a running step still preparing has its own lines as aide-before (AC-3)", async () => {
    const stream = withRunLog(tempStreamFile([]), ["aide-run-spec 10:45:08 +0s waiting for the checkout lock"]);
    const view = await jobDetailView(makeCtx(), makeJob({ state: "running", streamFile: stream }));

    expect(view.runningStep!.logs.map((p) => p.by)).toEqual(["aide-before"]);
  });
});

const twoCommandsOnly = () => [{ type: "result", subtype: "success", result: "x" }];

describe("the AI's label", () => {
  test("names the tool and the model choice, each word capitalised (AC-4)", () => {
    expect(aiLabel("claude", "sonnet")).toBe("Claude Sonnet");
    expect(aiLabel("codex", "codex")).toBe("Codex");
    expect(aiLabel("claude", undefined)).toBe("Claude");
    expect(aiLabel("none", "sonnet")).toBeUndefined();
  });

  test("a finished step carries the label of the choice its job named (AC-4)", async () => {
    const job = makeJob({
      model: { implement: "sonnet" },
      results: [{ step: "implement", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile: tempStreamFile(twoCommandsOnly()), tool: "claude" }],
    });
    const view = await jobDetailView(makeCtx(), job);

    expect(view.results[0]!.aiModel).toBe("Claude Sonnet");
  });
});
