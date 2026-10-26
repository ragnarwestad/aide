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
  test("a review on codex and a verification on Opus are handed to an implement on claude", () => {
    const o = { modelChoices: CHOICES, model: { implement: "Sonnet", review: "gpt-6.1-sol", verify: "Opus" } };
    const job = { project: "aide", specFolder: "1-x", steps: ["implement"], timeoutSec: {}, permissionMode: {}, model: {} } as unknown as Job;
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { runnerBin: "/bin/r", projectDir: "/p", push: "branch", ...o });

    expect(argv.join(" ")).toContain("--review-model gpt-6.1-sol --review-tool codex --verify-model opus --verify-tool claude");
  });

  test("no other step is handed them", () => {
    expect(reviewModelArgs("analyze", "claude", { modelChoices: CHOICES, model: { review: "gpt-6.1-sol" } })).toEqual([]);
  });

  test("a choice on a tool that is neither the step's nor codex is left out", () => {
    const o = { modelChoices: CHOICES, model: { review: "big-pickle", verify: "Opus" } };

    expect(reviewModelArgs("implement", "codex", o)).toEqual([]);
    expect(reviewModelArgs("implement", "claude", o)).toEqual(["--verify-model", "opus", "--verify-tool", "claude"]);
  });
});
