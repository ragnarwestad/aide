// The flags `runnerArgv` adds for what a job or its schedule entry asks
// for, and the analysis session an implement continues.

import { describe, expect, test } from "bun:test";
import { runnerArgv } from "../../../../src/serve/serve-helpers";
import { analysisSessionToResume } from "../../../../src/serve/serve-helpers/runner-argv.ts";

// `--reset-files` reaches the runner for a `reopen` job that asked
// for it, and for nothing else.
describe("--reset-files", () => {
  const argvFor = (step: string, extra: Record<string, unknown>): string[] =>
    runnerArgv(
      {
        id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: [step], stepIndex: 0,
        model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [], ...extra,
      } as unknown as Parameters<typeof runnerArgv>[0],
      step, "/tmp/r.json", { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch" },
    );

  test("a reopen job with resetFiles passes it", () => {
    expect(argvFor("reopen", { resetFiles: true })).toContain("--reset-files");
  });
  test("a reopen job without resetFiles does not", () => {
    expect(argvFor("reopen", {})).not.toContain("--reset-files");
  });
  test("another step never passes it, whatever the job says", () => {
    expect(argvFor("analyze", { resetFiles: true })).not.toContain("--reset-files");
  });
});

describe("--chrome", () => {
  const argvFor = (chrome: boolean | undefined): string[] =>
    runnerArgv(
      {
        id: "j1", project: "aide", specFolder: "schedule-x-list", steps: ["schedule"], stepIndex: 0,
        model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
      } as unknown as Parameters<typeof runnerArgv>[0],
      "schedule", "/tmp/r.json",
      { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch", promptFile: "docs/x.md", chrome },
    );

  test("a scheduled job whose entry asks for Chrome passes it", () => {
    expect(argvFor(true)).toContain("--chrome");
  });
  test("one whose entry does not, does not", () => {
    expect(argvFor(false)).not.toContain("--chrome");
    expect(argvFor(undefined)).not.toContain("--chrome");
  });
});

describe("--no-sandbox", () => {
  const argvFor = (noSandbox: boolean | undefined, tool: "claude" | "codex" = "claude"): string[] =>
    runnerArgv(
      {
        id: "j1", project: "aide", specFolder: "schedule-nightly-e2e", steps: ["schedule"], stepIndex: 0,
        model: { schedule: "chosen" }, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
      } as unknown as Parameters<typeof runnerArgv>[0],
      "schedule", "/tmp/r.json",
      { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch", promptFile: "docs/x.md", noSandbox, modelChoices: { chosen: { tool } } },
    );

  test("a scheduled job whose entry turns the sandbox off passes it", () => {
    expect(argvFor(true)).toContain("--no-sandbox");
  });
  test("Codex runs without the Claude-only flag even when the entry disables the sandbox", () => {
    const argv = argvFor(true, "codex");
    expect(argv).toContain("codex");
    expect(argv).not.toContain("--no-sandbox");
  });
  test("one whose entry does not, does not", () => {
    expect(argvFor(false)).not.toContain("--no-sandbox");
    expect(argvFor(undefined)).not.toContain("--no-sandbox");
  });
});

// An implement continues its analysis's own session: the latest finished
// analysis of the spec, run with the same AI, ended within the hour.
describe("the analysis session an implement continues", () => {
  const NOW = Date.parse("2026-09-26T14:00:00Z");
  const job = (results: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    ({ id: "j", project: "aide", specFolder: "541-x", steps: ["analyze", "implement"], results, ...extra }) as never;
  const analysis = (at: string, extra: Record<string, unknown> = {}) =>
    ({ step: "analyze", ok: true, sessionId: "s-analyze", tool: "claude", at, ...extra });

  test("a recent analysis with the same AI is continued", () => {
    const j = job([analysis("2026-09-26T13:30:00Z")]);
    expect(analysisSessionToResume(j, [j], "claude", NOW)).toBe("s-analyze");
  });

  test("one older than an hour, run with another AI, or not finished, is not", () => {
    for (const r of [
      analysis("2026-09-26T12:30:00Z"),
      analysis("2026-09-26T13:30:00Z", { tool: "codex" }),
      analysis("2026-09-26T13:30:00Z", { ok: false }),
    ]) {
      const j = job([r]);
      expect(analysisSessionToResume(j, [j], "claude", NOW)).toBeUndefined();
    }
  });

  test("the analysis may be in an earlier job for the same spec, and the latest one wins", () => {
    const earlier = job([analysis("2026-09-26T13:10:00Z", { sessionId: "s-old" }), analysis("2026-09-26T13:40:00Z", { sessionId: "s-new" })], { id: "e" });
    const other = job([analysis("2026-09-26T13:50:00Z", { sessionId: "s-other" })], { id: "o", specFolder: "540-y" });
    const now = job([], { id: "n", steps: ["implement"] });
    expect(analysisSessionToResume(now, [earlier, other, now], "claude", NOW)).toBe("s-new");
  });

  test("it is continued across two Codex providers that share a CODEX_HOME, not across two that do not (AC-16)", () => {
    const providers = {
      A: { name: "A", tool: "codex", codexHome: "/shared", shadowHome: "/shadow-a" },
      B: { name: "B", tool: "codex", codexHome: "/shared", shadowHome: "/shadow-b" },
      C: { name: "C", tool: "codex", codexHome: "/own" },
    } as never;
    const j = job([analysis("2026-09-26T13:30:00Z", { tool: "codex", provider: { key: "A", name: "A" } })]);
    expect(analysisSessionToResume(j, [j], "codex", NOW, { key: "B", providers })).toBe("s-analyze");
    expect(analysisSessionToResume(j, [j], "codex", NOW, { key: "C", providers })).toBeUndefined();
  });

  test("only an implement is handed the session", () => {
    const argvFor = (step: string): string[] =>
      runnerArgv(
        {
          id: "j1", project: "aide", specFolder: "541-x", steps: [step], stepIndex: 0,
          model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
        } as unknown as Parameters<typeof runnerArgv>[0],
        step, "/tmp/r.json", { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch", resumeSession: "s-analyze" },
      );
    expect(argvFor("implement")).toContain("--resume-session");
    expect(argvFor("archive")).not.toContain("--resume-session");
  });
});

// A step runs with the folder its provider keeps its login in; nothing else
// changes its argv.
describe("--claude-config-dir and --codex-home", () => {
  const providers = {
    Claude: { name: "Claude", tool: "claude" },
    Capra: { name: "Capra", tool: "claude", configDir: "~/.claude-2" },
    Codex: { name: "Codex", tool: "codex" },
    "Codex-own": { name: "Codex-own", tool: "codex", codexHome: "/opt/codex-own" },
    "Codex-shadow": { name: "Codex-shadow", tool: "codex", codexHome: "/opt/codex-shared", shadowHome: "~/.codex-shadow" },
  } as const;
  const choices = { opus: {}, gpt: { tool: "codex" } } as never;
  const argvFor = (provider: string, model = "opus"): string[] =>
    runnerArgv(
      {
        id: "j1", project: "aide", specFolder: "700-x", steps: ["implement"], stepIndex: 0,
        model: { implement: model }, provider: { implement: provider }, timeoutSec: {}, permissionMode: {},
        state: "queued", createdAt: "", results: [],
      } as unknown as Parameters<typeof runnerArgv>[0],
      "implement", "/tmp/r.json",
      { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch", modelChoices: choices, providers, home: "/home/ragnar" } as never,
    );
  const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

  test("a Claude Code provider with a config folder hands it over expanded (AC-14)", () => {
    expect(after(argvFor("Capra"), "--claude-config-dir")).toBe("/home/ragnar/.claude-2");
  });

  test("a Claude Code provider with no folder, and a Codex step, are handed no config folder (AC-14)", () => {
    expect(argvFor("Claude")).not.toContain("--claude-config-dir");
    expect(argvFor("Codex-own", "gpt")).not.toContain("--claude-config-dir");
  });

  test("a Codex provider hands over its shadow home, else its CODEX_HOME, else nothing (AC-15)", () => {
    expect(after(argvFor("Codex-shadow", "gpt"), "--codex-home")).toBe("/home/ragnar/.codex-shadow");
    expect(after(argvFor("Codex-own", "gpt"), "--codex-home")).toBe("/opt/codex-own");
    expect(argvFor("Codex", "gpt")).not.toContain("--codex-home");
    expect(argvFor("Capra")).not.toContain("--codex-home");
  });
});
