import { describe, expect, test } from "bun:test";
import { reviewModelArgs, runnerArgv } from "../../../src/serve/serve-helpers/runner-argv.ts";
import type { Job } from "../../../src/queue/queue.ts";

const CHOICES = {
  Opus: { model: "opus" },
  Sonnet: { model: "sonnet" },
  "gpt-6.1-sol": { tool: "codex" as const, model: "gpt-6.1-sol" },
  "big-pickle": { tool: "opencode" as const, model: "opencode/big-pickle" },
};

describe("the models an implement's review and verification run on", () => {
  test("a review on codex and a verification on Opus are handed to an implement on claude (AC-10)", () => {
    const o = { modelChoices: CHOICES, model: { implement: "Sonnet", review: "gpt-6.1-sol", verify: "Opus" } };
    const job = { project: "aide", specFolder: "1-x", steps: ["implement"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { runnerBin: "/bin/r", projectDir: "/p", push: "branch", ...o });

    expect(argv.join(" ")).toContain("--review-model gpt-6.1-sol --review-tool codex --verify-model opus --verify-tool claude");
  });

  test("no other step is handed them (AC-5, AC-6)", () => {
    expect(reviewModelArgs("analyze", "claude", { modelChoices: CHOICES, model: { review: "gpt-6.1-sol" } })).toEqual([]);
  });

  test("a choice on another tool reaches the runner so it can refuse it (AC-14)", () => {
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

  test("the current spec's side picks win over Models per phase (AC-10, AC-11)", () => {
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
});
