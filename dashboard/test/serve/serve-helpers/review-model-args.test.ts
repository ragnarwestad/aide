import { describe, expect, test } from "bun:test";
import { launchProviders, reviewModelArgs, runnerArgv } from "../../../src/serve/serve-helpers/runner-argv.ts";
import type { Job } from "../../../src/queue/queue.ts";

const CHOICES = {
  Opus: { model: "opus" },
  Sonnet: { model: "sonnet" },
  "gpt-6.1-sol": { tool: "codex" as const, model: "gpt-6.1-sol" },
  "big-pickle": { tool: "opencode" as const, model: "opencode/big-pickle" },
};

describe("the models an implement's review and verification run on", () => {
  test("one launch snapshot supplies the main and side provider keys (AC-1, AC-5)", () => {
    const job = { project: "aide", specFolder: "827-x", steps: ["implement"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    expect(launchProviders(job, "implement", {
      modelChoices: CHOICES,
      model: { implement: "Sonnet", review: "gpt-6.1-sol", verify: "Opus" },
      provider: { implement: "Claude-A", review: "Codex-B", verify: "Claude-C" },
      providers: {
        "Claude-A": { name: "Claude A", tool: "claude" },
        "Codex-B": { name: "Codex B", tool: "codex" },
        "Claude-C": { name: "Claude C", tool: "claude" },
      },
    })).toEqual({ implement: "Claude-A", review: "Codex-B", verify: "Claude-C" });
  });
  test("a launch without configured providers records that empty answer (AC-1, AC-3)", () => {
    const job = { project: "aide", specFolder: "827-x", steps: ["implement"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    expect(launchProviders(job, "implement", {
      modelChoices: CHOICES,
      model: { implement: "Sonnet", review: "Opus", verify: "gpt-6.1-sol" },
    })).toEqual({ implement: "", review: "", verify: "" });
  });
  test("both parts inherit the default model when their own settings are empty (AC-3, AC-5, AC-6)", () => {
    expect(reviewModelArgs("implement", "claude", { modelChoices: CHOICES, model: { default: "gpt-6.1-sol" } })).toEqual([
      "--review-model", "gpt-6.1-sol", "--review-tool", "codex",
      "--verify-model", "gpt-6.1-sol", "--verify-tool", "codex",
    ]);
  });
  test("a default model outside the catalogue resolves to the same listed model the row shows (AC-3)", () => {
    expect(reviewModelArgs("implement", "claude", { modelChoices: { Sonnet: CHOICES.Sonnet }, model: { default: "opus" } })).toEqual([
      "--review-model", "sonnet", "--review-tool", "claude",
      "--verify-model", "sonnet", "--verify-tool", "claude",
    ]);
  });
  test("an inherited Codex model uses the first compatible provider and its account folder (AC-3, AC-5)", () => {
    expect(reviewModelArgs("implement", "claude", {
      home: "/home/test",
      modelChoices: { "gpt-6.1-sol": CHOICES["gpt-6.1-sol"] },
      model: { default: "gpt-6.1-sol" },
      providers: { Codex: { name: "Codex", tool: "codex", codexHome: "~/.codex-work" } },
    })).toEqual([
      "--review-model", "gpt-6.1-sol", "--review-tool", "codex", "--review-codex-home", "/home/test/.codex-work",
      "--verify-model", "gpt-6.1-sol", "--verify-tool", "codex", "--verify-codex-home", "/home/test/.codex-work",
    ]);
  });
  test("a review on codex and a verification on Opus are handed to an implement on claude (AC-10)", () => {
    const o = { modelChoices: CHOICES, model: { implement: "Sonnet", review: "gpt-6.1-sol", verify: "Opus" } };
    const job = { project: "aide", specFolder: "1-x", steps: ["implement"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { runnerBin: "/bin/r", projectDir: "/p", push: "branch", ...o });

    expect(argv.join(" ")).toContain("--review-model gpt-6.1-sol --review-tool codex --verify-model opus --verify-tool claude");
  });

  test("no other step is handed them (AC-5, AC-6)", () => {
    expect(reviewModelArgs("analyze", "claude", { modelChoices: CHOICES, model: { review: "gpt-6.1-sol" } })).toEqual([]);
  });

  test("a choice on another tool reaches the runner unchanged (AC-1)", () => {
    const o = { modelChoices: CHOICES, model: { review: "big-pickle", verify: "Opus" } };

    expect(reviewModelArgs("implement", "codex", o)).toEqual([
      "--review-model", "opencode/big-pickle", "--review-tool", "opencode",
      "--verify-model", "opus", "--verify-tool", "claude",
    ]);
    expect(reviewModelArgs("implement", "claude", o)).toEqual([
      "--review-model", "opencode/big-pickle", "--review-tool", "opencode",
      "--verify-model", "opus", "--verify-tool", "claude",
    ]);
  });

  test("the current spec's side picks win over Models per phase (AC-4)", () => {
    const o = { modelChoices: CHOICES, model: { review: "Sonnet" }, sidePicks: { review: "gpt-6.1-sol" } };

    expect(reviewModelArgs("implement", "claude", o)).toEqual([
      "--review-model", "gpt-6.1-sol", "--review-tool", "codex",
    ]);
  });

  test("a side pick carries its own AI account folders (AC-10)", () => {
    const job = { project: "aide", specFolder: "1-x", steps: ["implement"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    const argv = runnerArgv(job, "implement", "/tmp/r.json", {
      runnerBin: "/bin/r", projectDir: "/p", push: "branch", home: "/home/test",
      modelChoices: CHOICES, model: { implement: "Sonnet" }, sidePicks: { review: "gpt-6.1-sol" },
      sideProviders: { review: "Codex-B" },
      providers: { "Codex-B": { name: "Codex B", tool: "codex", codexHome: "/accounts/codex-b" } },
    });

    expect(argv).toContain("--review-codex-home");
    expect(argv).toContain("/accounts/codex-b");
  });

  test("an Analyze Review pick on a Codex provider reaches analyze with its account folder (AC-2)", () => {
    expect(reviewModelArgs("analyze", "claude", {
      home: "/home/test",
      modelChoices: CHOICES,
      model: { analyze: "Opus" },
      sidePicks: { "plan-review": "gpt-6.1-sol" },
      sideProviders: { "plan-review": "Codex-B" },
      providers: { "Codex-B": { name: "Codex B", tool: "codex", codexHome: "/accounts/codex-b" } },
    })).toEqual([
      "--plan-review-model", "gpt-6.1-sol", "--plan-review-tool", "codex", "--plan-review-codex-home", "/accounts/codex-b",
    ]);
  });

  test("Settings' Analyze Review reaches analyze, and the spec's own pick wins over it (AC-2)", () => {
    const o = { modelChoices: CHOICES, model: { "plan-review": "Sonnet" } };
    const job = { project: "aide", specFolder: "1-x", steps: ["analyze"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", { runnerBin: "/bin/r", projectDir: "/p", push: "branch", ...o });

    expect(argv.join(" ")).toContain("--plan-review-model sonnet --plan-review-tool claude");
    expect(reviewModelArgs("analyze", "claude", { ...o, sidePicks: { "plan-review": "gpt-6.1-sol" } })).toEqual([
      "--plan-review-model", "gpt-6.1-sol", "--plan-review-tool", "codex",
    ]);
  });

  test("each step is handed only its own parts when all three are chosen (AC-5)", () => {
    const o = { modelChoices: CHOICES, model: { review: "Sonnet", verify: "Opus", "plan-review": "gpt-6.1-sol" } };

    expect(reviewModelArgs("implement", "claude", o)).toEqual([
      "--review-model", "sonnet", "--review-tool", "claude",
      "--verify-model", "opus", "--verify-tool", "claude",
    ]);
    expect(reviewModelArgs("analyze", "claude", o)).toEqual(["--plan-review-model", "gpt-6.1-sol", "--plan-review-tool", "codex"]);
  });
});
