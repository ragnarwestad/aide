// The lookup behind a phase's unfolded messages — which attempt
// it reads, what it returns, and the key it links to on the Logs tab.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { specPageView, type SpecViewsContext } from "../../../src/serve/spec-views";
import { phaseMessagesFor } from "../../../src/serve/spec-views/phase-messages.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { fakeGit } from "../../helpers/fake-git.ts";
import { feasibility, ran as codexRan, said as codexSaid, S, started, T, writeSessions } from "../../helpers/codex-fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "phase-messages-"));
let n = 0;
const stream = (lines: unknown[]): string => {
  const file = join(dir, `s${n++}.stream.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
};
const said = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const ran = (command: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${n++}`, name: "Bash", input: { command } }] } });
const result = (text: string) => ({ type: "result", subtype: "success", result: text });

const job = (id: string, extra: Partial<Job> = {}): Job =>
  ({
    id,
    project: "aide",
    specFolder: "500-x",
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    timeoutSec: {},
    permissionMode: {},
    model: {},
    createdAt: "2026-09-19T10:00:00Z",
    startedAt: "2026-09-19T10:00:00Z",
    results: [],
    spentUsd: 0,
    ...extra,
  }) as Job;
const finishedStep = (step: string, lines: unknown[]) =>
  ({ step, ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", tool: "claude", streamFile: stream(lines) }) as never;

/** The queue, as far as the lookup and the spec page read it. */
const queueOf = (jobs: Job[]) =>
  ({ get: (id: string) => jobs.find((j) => j.id === id), list: () => jobs, defaults: {} }) as never;

const lines = (got: { logs: { lines: string[] }[] } | undefined) => got?.logs.flatMap((part) => part.lines) ?? [];

describe("phaseMessagesFor", () => {
  // The model's own messages alone are not enough. A session that works
  // through commands writes a sentence every few minutes, so the row read
  // as frozen while the step was busy: what it DID belongs here too.
  test("Claude: what the run said and what it did, oldest first", () => {
    const out: unknown[] = [];
    for (let i = 1; i <= 3; i++) out.push(said(`m${i}`), ran(`cmd ${i}`));
    const j = job("a", { results: [finishedStep("analyze", out)] });
    const got = phaseMessagesFor(queueOf([j]), ["a"], "analyze");
    expect(lines(got)).toEqual(["m1", "Bash cmd 1", "m2", "Bash cmd 2", "m3", "Bash cmd 3"]);
    expect(got?.running).toBe(false);
  });

  test("a file a step wrote is a line of its own", () => {
    const wrote = { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/x/2-analysis.md" } }] } };
    const j = job("a", { results: [finishedStep("analyze", [wrote])] });
    expect(lines(phaseMessagesFor(queueOf([j]), ["a"], "analyze"))).toEqual(["Write /x/2-analysis.md"]);
  });

  test("a newer job only queued for the step does not hide the older one that ran it; two finished jobs give the newer", () => {
    const older = job("old", { createdAt: "2026-09-19T09:00:00Z", results: [finishedStep("analyze", [said("from old")])] });
    const newer = job("new", { createdAt: "2026-09-19T10:00:00Z", results: [finishedStep("analyze", [said("from new")])] });
    const queued = job("queued", { createdAt: "2026-09-19T11:00:00Z", state: "queued" });
    const q = queueOf([older, newer, queued]);
    expect(lines(phaseMessagesFor(q, ["queued", "old"], "analyze"))).toEqual(["from old"]);
    expect(lines(phaseMessagesFor(q, ["queued", "new", "old"], "analyze"))).toEqual(["from new"]);
  });

  test("nothing to read gives undefined", () => {
    expect(phaseMessagesFor(queueOf([]), ["gone"], "analyze")).toBeUndefined();
    expect(phaseMessagesFor(queueOf([job("q", { state: "queued" })]), ["q"], "analyze")).toBeUndefined();
  });

  test("a message with markup is returned escaped once", () => {
    const j = job("a", { results: [finishedStep("analyze", [said('<b>x</b> & "y"')])] });
    expect(lines(phaseMessagesFor(queueOf([j]), ["a"], "analyze"))).toEqual(["&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;"]);
  });

  test("a finished phase ends with its final message, replacing a last entry that is the same", () => {
    const j = job("a", { results: [finishedStep("analyze", [said("first"), said("Analysis complete: 12 files affected"), result("Analysis complete: 12 files affected")])] });
    expect(lines(phaseMessagesFor(queueOf([j]), ["a"], "analyze"))).toEqual(["first", "Analysis complete: 12 files affected"]);
  });

  test("every line of the step is in the row, however long: the row is a window on the Log", () => {
    const out: unknown[] = [];
    for (let i = 1; i <= 250; i++) out.push(ran(`cmd ${i}`));
    out.push(result("The end"));
    const got = lines(phaseMessagesFor(queueOf([job("a", { results: [finishedStep("analyze", out)] })]), ["a"], "analyze"));
    expect(got).toHaveLength(251);
    expect(got[0]).toBe("Bash cmd 1");
    expect(got.at(-1)).toBe("The end");
  });

  // What Aide does around the AI — preparing, and after it the landing's
  // merge and its test run — is in the row too, in its place: an archive's
  // row went quiet for the landing's whole test run.
  test("Aide's own lines from the step's run log stand before and after the AI's, in order", () => {
    const streamFile = stream([said("archiving")]);
    writeFileSync(
      streamFile.replace(/\.stream\.jsonl$/, ".run.log"),
      [
        "aide-run-spec 10:00:00 +0s --- Step Aide: preparing — started",
        "aide-run-spec 10:00:02 +2s --- Step Aide: preparing — done",
        "aide-run-spec 10:00:02 +2s model turn started (transcript at byte 0)",
        "aide-run-spec 10:01:00 +60s --- Step 5 of 5: Merge into main — started",
        "aide-run-spec 10:02:00 +120s tests: pytest 50%",
      ].join("\n") + "\n",
    );
    const j = job("a", { results: [{ step: "archive", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", tool: "claude", streamFile } as never] });
    const got = phaseMessagesFor(queueOf([j]), ["a"], "archive");
    expect(got?.logs.map((part) => part.by)).toEqual(["aide-before", "ai", "aide-after"]);
    expect(lines(got)).toEqual([
      "10:00:00 +0s --- Step Aide: preparing — started",
      "10:00:02 +2s --- Step Aide: preparing — done",
      "archiving",
      "10:01:00 +60s --- Step 5 of 5: Merge into main — started",
      "10:02:00 +120s tests: pytest 50%",
    ]);
  });

  test("a running phase reads the job's live transcript, with no final-message rule", () => {
    const live = stream([said("working"), result("would be final")]);
    const j = job("r", { state: "running", steps: ["analyze"], stepIndex: 0, streamFile: live });
    const got = phaseMessagesFor(queueOf([j]), ["r"], "analyze");
    expect(got?.running).toBe(true);
    expect(lines(got)).toEqual(["working"]);
    expect(got?.step).toBe("live");
  });
});

// The steps the attempt's log has marked, with their time and tokens: what a phase's unfold
// lists above its Log.
describe("phaseMessagesFor: the steps the log has marked", () => {
  const usage = (n: number) => ({ input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const call = (id: string, text: string, tokens: number) => ({ type: "assistant", message: { id, content: [{ type: "text", text }], usage: usage(tokens) } });
  /** A stream and its run log, whose lines are stamped `[seconds, text]`. */
  const logged = (events: unknown[], runLog: [number, string][]): string => {
    const file = stream(events);
    writeFileSync(file.replace(/\.stream\.jsonl$/, ".run.log"), runLog.map(([sec, l]) => `aide-run-spec 10:00:00 +${sec}s ${l}`).join("\n") + "\n");
    return file;
  };
  const RUN_LOG: [number, string][] = [
    [0, "--- Step Aide: preparing — started"],
    [2, "--- Step Aide: preparing — done"],
    [2, "model turn started (transcript at byte 0)"],
    [3, "--- Step 1 of 2: Read — started"],
    [10, "--- Step 1 of 2: Read — done"],
    [11, "--- Step 2 of 2: Write — started"],
  ];
  const EVENTS = [call("m1", "--- Step 1 of 2: Read — started", 100), call("m2", "--- Step 1 of 2: Read — done", 20), call("m3", "--- Step 2 of 2: Write — started", 7)];

  test("a finished attempt lists them in the order marked, Aide's own among them, each with its seconds and tokens", () => {
    const runLog: [number, string][] = [...RUN_LOG, [30, "--- Step 2 of 2: Write — done"], [31, "--- Step Aide: tests and commit — started"], [40, "--- Step Aide: tests and commit — done"]];
    const streamFile = logged([...EVENTS, call("m4", "--- Step 2 of 2: Write — done", 3)], runLog);
    const j = job("a", { results: [{ step: "analyze", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", tool: "claude", streamFile } as never] });
    const got = phaseMessagesFor(queueOf([j]), ["a"], "analyze");
    expect(got?.steps.map((s) => [s.label, s.state, s.seconds, s.tokens])).toEqual([
      ["Preparing", "done", 2, undefined],
      ["Read", "done", 7, 120],
      ["Write", "done", 19, 10],
      ["Tests and commit", "done", 9, undefined],
    ]);
    expect(got?.steps.find((s) => s.label === "Read")?.logs?.flatMap((p) => p.lines).join("\n")).toContain("Read — started");
  });

  test("a running attempt counts its open step from its start", () => {
    const streamFile = logged(EVENTS, RUN_LOG);
    const j = job("r", { state: "running", steps: ["analyze"], stepIndex: 0, streamFile, stepStartedAt: "2026-09-19T10:00:00Z" });
    const write = phaseMessagesFor(queueOf([j]), ["r"], "analyze")?.steps.find((s) => s.label === "Write");
    expect(write).toMatchObject({ state: "running", since: "2026-09-19T10:00:11.000Z", tokens: 7 });
    expect(write?.seconds).toBeUndefined();
  });

  test("an attempt that marked no step lists none, and the Log is as before", () => {
    const j = job("a", { results: [finishedStep("analyze", [said("plain words")])] });
    const got = phaseMessagesFor(queueOf([j]), ["a"], "analyze");
    expect(got?.steps).toEqual([]);
    expect(lines(got)).toEqual(["plain words"]);
  });
});

describe("the key it returns is the Logs tab's own", () => {
  const ctxFor = (jobs: Job[]): SpecViewsContext =>
    ({
      projectRoot: "/repos/aide",
      targets: () => [],
      peekUnlanded: () => [],
      peekUnlandedCheckedAt: () => null,
      readPrOpen: () => [],
      readScan: () => null,
      queue: { ...(queueOf(jobs) as object), branchesFor: () => [] } as never,
      specDir: () => dir,
      specRef: () => undefined,
      peekMachinerySpecDir: (_p: string, d: string) => d,
      machinerySpecDir: async (_p: string, d: string) => d,
      gitRun: fakeGit({}).run,
      withFreshness: (list: unknown[]) => list,
      jobRow: async (j: Job) => ({ ...j }),
      specFileCommits: { peekCommitFor: () => ({}), commitFor: async () => ({}) },
      branchStatus: { openSpecBranches: async () => new Set<string>() },
      specsRoot: async (d: string) => d,
      specCreatedAt: {},
      pdfToolAvailable: false,
      testServers: { previewAvailable: () => false, aideCheckout: () => undefined, store: { get: () => undefined } },
    }) as never;

  test("every step's key equals its index in the spec page's steps, and a running step is live", async () => {
    const first = job("j1", {
      steps: ["analyze", "implement"],
      stepIndex: 1,
      createdAt: "2026-09-19T09:00:00Z",
      startedAt: "2026-09-19T09:00:00Z",
      results: [finishedStep("analyze", [said("a1")]), finishedStep("implement", [said("i1")])],
    });
    const second = job("j2", {
      steps: ["analyze", "implement"],
      stepIndex: 1,
      state: "running",
      createdAt: "2026-09-19T10:00:00Z",
      startedAt: "2026-09-19T10:00:00Z",
      streamFile: stream([said("live words")]),
      results: [finishedStep("analyze", [said("a2")])],
    });
    const jobs = [first, second];
    const q = queueOf(jobs);
    const view = await specPageView(ctxFor(jobs), "aide", "500-x");
    const steps = view!.steps!;
    const indexOf = (text: string) => steps.findIndex((s) => (s.logs ?? []).flatMap((p) => p.lines).join("\n").includes(text));
    expect(phaseMessagesFor(q, ["j1"], "analyze")?.step).toBe(String(indexOf("a1")));
    expect(phaseMessagesFor(q, ["j1"], "implement")?.step).toBe(String(indexOf("i1")));
    expect(phaseMessagesFor(q, ["j2", "j1"], "analyze")?.step).toBe(String(indexOf("a2")));
    expect(indexOf("a2")).toBeGreaterThan(indexOf("i1"));
    expect(phaseMessagesFor(q, ["j2"], "implement")?.step).toBe("live");
    expect(view!.lead?.runningStep?.step).toBe("implement");
  });
});

describe("a Codex phase's row reads the session files", () => {
  const codexStream = () => stream([started(T), codexSaid("m1"), codexRan("c1"), codexSaid("m2")]);
  const withHome = <R>(run: () => R): R => {
    const home = mkdtempSync(join(tmpdir(), "phase-codex-"));
    writeSessions(home, { [T]: feasibility.parent, [S]: feasibility.child });
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  };

  test("a finished step's parts include the subagent's", () => {
    const j = job("a", { results: [{ step: "analyze", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", tool: "codex", streamFile: codexStream() } as never] });
    const got = withHome(() => phaseMessagesFor(queueOf([j]), ["a"], "analyze"));

    expect(got?.logs.map((part) => part.by)).toEqual(["ai", "subagent", "ai"]);
  });

  test("a running step's parts include it too", () => {
    const j = job("r", { state: "running", steps: ["analyze"], stepIndex: 0, streamFile: codexStream() });
    const got = withHome(() => phaseMessagesFor(queueOf([j]), ["r"], "analyze"));

    expect(got?.logs.map((part) => part.by)).toEqual(["ai", "subagent", "ai"]);
  });
});
