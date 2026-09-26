// Spec 500: the lookup behind a phase's unfolded messages — which attempt
// it reads, what it returns, and the key it links to on the Logs tab.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { specPageView, type SpecViewsContext } from "../../../src/serve/spec-views";
import { phaseMessagesFor } from "../../../src/serve/spec-views/phase-messages.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

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

describe("phaseMessagesFor", () => {
  // Spec 500 kept the model's own messages alone. A session that works
  // through commands writes a sentence every few minutes, so the row read
  // as frozen while the step was busy: what it DID belongs here too.
  test("Claude: what the run said and what it did, oldest first", () => {
    const lines: unknown[] = [];
    for (let i = 1; i <= 3; i++) lines.push(said(`m${i}`), ran(`cmd ${i}`));
    const j = job("a", { results: [finishedStep("analyze", lines)] });
    const got = phaseMessagesFor(queueOf([j]), ["a"], "analyze");
    expect(got?.messages).toEqual(["m1", "Bash cmd 1", "m2", "Bash cmd 2", "m3", "Bash cmd 3"]);
    expect(got?.running).toBe(false);
  });

  test("a file a step wrote is a line of its own", () => {
    const wrote = { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/x/2-analysis.md" } }] } };
    const j = job("a", { results: [finishedStep("analyze", [wrote])] });
    expect(phaseMessagesFor(queueOf([j]), ["a"], "analyze")?.messages).toEqual(["Write /x/2-analysis.md"]);
  });

  // The last 200, so a long implement keeps its newest lines and the row
  // cannot grow without bound.
  test("the last 200 lines are kept, newest last", () => {
    const lines: unknown[] = [];
    for (let i = 1; i <= 250; i++) lines.push(ran(`cmd ${i}`));
    const j = job("a", { results: [finishedStep("analyze", lines)] });
    const got = phaseMessagesFor(queueOf([j]), ["a"], "analyze")?.messages ?? [];
    expect(got).toHaveLength(200);
    expect(got[0]).toBe("Bash cmd 51");
    expect(got[got.length - 1]).toBe("Bash cmd 250");
  });

  test("a newer job only queued for the step does not hide the older one that ran it; two finished jobs give the newer (AC-2)", () => {
    const older = job("old", { createdAt: "2026-09-19T09:00:00Z", results: [finishedStep("analyze", [said("from old")])] });
    const newer = job("new", { createdAt: "2026-09-19T10:00:00Z", results: [finishedStep("analyze", [said("from new")])] });
    const queued = job("queued", { createdAt: "2026-09-19T11:00:00Z", state: "queued" });
    const q = queueOf([older, newer, queued]);
    expect(phaseMessagesFor(q, ["queued", "old"], "analyze")?.messages).toEqual(["from old"]);
    expect(phaseMessagesFor(q, ["queued", "new", "old"], "analyze")?.messages).toEqual(["from new"]);
  });

  test("nothing to read gives undefined (AC-5)", () => {
    expect(phaseMessagesFor(queueOf([]), ["gone"], "analyze")).toBeUndefined();
    expect(phaseMessagesFor(queueOf([job("q", { state: "queued" })]), ["q"], "analyze")).toBeUndefined();
  });

  test("a message with markup is returned escaped once (AC-2)", () => {
    const j = job("a", { results: [finishedStep("analyze", [said('<b>x</b> & "y"')])] });
    expect(phaseMessagesFor(queueOf([j]), ["a"], "analyze")?.messages).toEqual(["&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;"]);
  });

  test("a finished phase ends with its final message, replacing a last entry that is the same (AC-4)", () => {
    const j = job("a", { results: [finishedStep("analyze", [said("first"), said("Analysis complete: 12 files affected"), result("Analysis complete: 12 files affected")])] });
    expect(phaseMessagesFor(queueOf([j]), ["a"], "analyze")?.messages).toEqual(["first", "Analysis complete: 12 files affected"]);
  });

  test("a transcript that ends after a tool call gets the final message appended, and the list stays at its cap (AC-4)", () => {
    const lines: unknown[] = [];
    for (let i = 1; i <= 200; i++) lines.push(said(`m${i}`));
    lines.push(ran("ls"), result("The end"));
    const got = phaseMessagesFor(queueOf([job("a", { results: [finishedStep("analyze", lines)] })]), ["a"], "analyze");
    expect(got?.messages).toHaveLength(200);
    expect(got?.messages.at(-1)).toBe("The end");
    expect(got?.messages.at(-2)).toBe("Bash ls");
  });

  test("the final message is shown whole at 500 characters and cut with … past 2,000 (AC-4)", () => {
    const at = (len: number) => phaseMessagesFor(queueOf([job("a", { results: [finishedStep("analyze", [result("x".repeat(len))])] })]), ["a"], "analyze")?.messages.at(-1) ?? "";
    expect(at(500)).toBe("x".repeat(500));
    expect(at(2500)).toBe(`${"x".repeat(2000)}…`);
    // the cut backs off rather than leaving half an entity
    const cut = phaseMessagesFor(queueOf([job("a", { results: [finishedStep("analyze", [result(`${"x".repeat(1999)}&${"y".repeat(50)}`)])] })]), ["a"], "analyze")?.messages.at(-1) ?? "";
    expect(cut).toBe(`${"x".repeat(1999)}…`);
  });

  test("a running phase reads the job's live transcript, with no final-message rule (AC-4)", () => {
    const live = stream([said("working"), result("would be final")]);
    const j = job("r", { state: "running", steps: ["analyze"], stepIndex: 0, streamFile: live });
    const got = phaseMessagesFor(queueOf([j]), ["r"], "analyze");
    expect(got?.running).toBe(true);
    expect(got?.messages).toEqual(["working"]);
    expect(got?.step).toBe("live");
  });
});

describe("the key it returns is the Logs tab's own (AC-5)", () => {
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
      dependencyFolders: () => [],
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
