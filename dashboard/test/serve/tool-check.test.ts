// What a Check button actually finds out, and what it refuses to claim.
//
// The point of these tests is the LAST part: a question that could not
// be answered has to stay unanswered on the page. A check that quietly
// turned "I could not ask" into "no" would have a reader reinstalling
// something that was never broken.

import { describe, expect, test } from "bun:test";
import { checkTool, forgetChecks, lastChecks, recordCheck, stripAnsi } from "../../src/serve/tool-check.ts";

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

const ESC = String.fromCharCode(27);

/** A stand-in for `runScript`, answering by the command it was given. */
function fakeRun(answers: Record<string, Partial<RunResult>>) {
  const calls: string[][] = [];
  const run = async (argv: string[]): Promise<RunResult> => {
    calls.push(argv);
    const key = Object.keys(answers).find((k) => argv.join(" ").includes(k));
    const answer = key ? answers[key]! : {};
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...answer };
  };
  return Object.assign(run as never as typeof import("../../src/serve/land-branch/run-script.ts").runScript, { calls });
}

const opts = (run: ReturnType<typeof fakeRun>, extra: Record<string, unknown> = {}) => ({
  run,
  scriptPath: (name: string) => name,
  now: () => new Date("2026-09-16T08:30:00.000Z"),
  ...extra,
});

describe("stripAnsi", () => {
  test("terminal colour is removed, the words are not", () => {
    expect(stripAnsi(`${ESC}[0;32m OK ${ESC}[0m done`)).toBe(" OK  done");
  });
});

describe("checkTool", () => {
  test("it runs the preflight for that tool and passes on what it printed", async () => {
    const run = fakeRun({
      "aide-preflight claude": { stdout: `${ESC}[0;32mClaude Code found${ESC}[0m (2.1.273)\n   skills -> ok\n` },
    });
    const check = await checkTool("claude", opts(run));
    expect(run.calls[0]).toEqual(["aide-preflight", "claude"]);
    expect(check.found).toBe(true);
    expect(check.lines).toEqual(["Claude Code found (2.1.273)", "   skills -> ok"]);
    expect(check.at).toBe("2026-09-16T08:30:00.000Z");
  });

  test("a tool the preflight could not find is reported as not found", async () => {
    const run = fakeRun({ "aide-preflight codex": { stdout: "Codex CLI is NOT installed\n" } });
    const check = await checkTool("codex", opts(run));
    expect(check.found).toBe(false);
  });

  test("a check that does not finish says so instead of reporting a result", async () => {
    const run = fakeRun({ "aide-preflight copilot": { timedOut: true, code: 143 } });
    const check = await checkTool("copilot", opts(run));
    expect(check.error).toBe("The check did not finish in time.");
    expect(check.lines).toEqual([]);
    expect(check.extra).toEqual([]);
  });

  test("only OpenCode is asked the two questions the others cannot answer", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "found\n" } });
    for (const tool of ["claude", "codex", "copilot"] as const) {
      const check = await checkTool(tool, opts(run));
      expect(check.extra).toEqual([]);
    }
    expect(run.calls.every((c) => c[0] === "aide-preflight")).toBe(true);
  });
});

describe("checkTool for OpenCode", () => {
  const preflight = { "aide-preflight opencode": { stdout: "OpenCode found (1.18.31)\n" } };

  test("no provider logged in is a failure, with the command to fix it", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { stdout: "Credentials\n0 credentials\n" },
    });
    const check = await checkTool("opencode", opts(run, { configuredModels: ["opencode/x"] }));
    const provider = check.extra.find((e) => e.question.includes("provider"))!;
    expect(provider.ok).toBe(false);
    expect(provider.detail).toContain("opencode providers login");
  });

  test("a configured model that is no longer listed is named", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { stdout: "1 credentials\n" },
      "opencode models": { stdout: "opencode/here\nopencode/also-here\n" },
    });
    const check = await checkTool(
      "opencode",
      opts(run, { configuredModels: ["opencode/here", "opencode/gone"] }),
    );
    const models = check.extra.find((e) => e.question.includes("models"))!;
    expect(models.ok).toBe(false);
    expect(models.detail).toContain("opencode/gone");
    expect(models.detail).not.toContain("opencode/here");
  });

  test("every configured model still listed is a pass", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { stdout: "1 credentials\n" },
      "opencode models": { stdout: "opencode/here\n" },
    });
    const check = await checkTool("opencode", opts(run, { configuredModels: ["opencode/here"] }));
    expect(check.extra.find((e) => e.question.includes("models"))!.ok).toBe(true);
  });

  // The rule this file exists for.
  test("a question that could not be asked stays unanswered, never a failure", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { code: 1 },
      "opencode models": { code: 1 },
    });
    const check = await checkTool("opencode", opts(run, { configuredModels: ["opencode/here"] }));
    for (const entry of check.extra) {
      expect(entry.ok).toBeNull();
    }
  });

  test("nothing configured for the tool is nothing to check, not a pass", async () => {
    const run = fakeRun({ ...preflight, "opencode providers list": { stdout: "1 credentials\n" } });
    const check = await checkTool("opencode", opts(run, { configuredModels: [] }));
    const models = check.extra.find((e) => e.question.includes("models"))!;
    expect(models.ok).toBeNull();
    // `opencode models` is not even run when there is nothing to compare.
    expect(run.calls.some((c) => c.join(" ").includes("opencode models"))).toBe(false);
  });
});

describe("what the page reads back", () => {
  test("a recorded check is what the next page load shows, per tool", () => {
    forgetChecks();
    expect(lastChecks()).toEqual({});
    recordCheck({ tool: "codex", at: "2026-09-16T08:00:00.000Z", found: true, lines: ["a"], extra: [] });
    recordCheck({ tool: "opencode", at: "2026-09-16T08:01:00.000Z", found: true, lines: ["b"], extra: [] });
    expect(Object.keys(lastChecks()).sort()).toEqual(["codex", "opencode"]);
    // A second check for the same tool replaces the first rather than
    // piling up: the page shows the latest answer, not a history.
    recordCheck({ tool: "codex", at: "2026-09-16T09:00:00.000Z", found: false, lines: ["c"], extra: [] });
    expect(lastChecks().codex?.lines).toEqual(["c"]);
    forgetChecks();
  });
});
