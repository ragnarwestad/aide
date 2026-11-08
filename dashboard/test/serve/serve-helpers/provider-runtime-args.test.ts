// What a provider's binary path and auto-compact threshold become on the
// runner's command line: `--bin` and `--autocompact` for the step, and
// `--review-bin` / `--verify-bin` for an implement's review and verification.

import { describe, expect, test } from "bun:test";
import { reviewModelArgs, runnerArgv } from "../../../src/serve/serve-helpers/runner-argv.ts";
import type { Provider } from "../../../src/queue/providers/index.ts";

const PROVIDERS: Record<string, Provider> = {
  capra: { name: "Claude Capra", tool: "claude", binary: "~/bin/claude-next", autoCompact: 300000 },
  plain: { name: "Claude", tool: "claude" },
  codex: { name: "Codex", tool: "codex", binary: "/opt/codex" },
  off: { name: "Off", tool: "claude", enabled: false, binary: "/opt/off" },
};
const CHOICES = { opus: {}, gpt: { tool: "codex" }, script: { tool: "fake-claude" } } as never;

const argvFor = (provider: string, model = "opus"): string[] =>
  runnerArgv(
    {
      id: "j1", project: "aide", specFolder: "700-x", steps: ["analyze"], stepIndex: 0,
      model: { analyze: model }, provider: { analyze: provider }, timeoutSec: {}, permissionMode: {},
      state: "queued", createdAt: "", results: [],
    } as unknown as Parameters<typeof runnerArgv>[0],
    "analyze", "/tmp/r.json",
    { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch", modelChoices: CHOICES, providers: PROVIDERS, home: "/home/r" } as never,
  );
const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe("the step's own provider", () => {
  test("a binary path is handed over expanded, for Claude Code and for Codex", () => {
    expect(after(argvFor("capra"), "--bin")).toBe("/home/r/bin/claude-next");
    expect(after(argvFor("codex", "gpt"), "--bin")).toBe("/opt/codex");
  });

  test("auto-compact is handed over for a Claude Code step", () => {
    expect(after(argvFor("capra"), "--autocompact")).toBe("300000");
  });

  test("a provider with neither hands over neither, and the stand-in model keeps its own program", () => {
    expect(argvFor("plain")).not.toContain("--bin");
    expect(argvFor("plain")).not.toContain("--autocompact");
    expect(argvFor("capra", "script")).not.toContain("--bin");
  });
});

describe("an implement's review and verification", () => {
  test("each hands over its provider's binary path", () => {
    expect(reviewModelArgs("implement", "claude", {
      home: "/home/r", modelChoices: { opus: {} } as never, model: { default: "opus" }, providers: { capra: PROVIDERS.capra! },
    })).toEqual([
      "--review-model", "opus", "--review-tool", "claude", "--review-bin", "/home/r/bin/claude-next",
      "--verify-model", "opus", "--verify-tool", "claude", "--verify-bin", "/home/r/bin/claude-next",
    ]);
  });

  test("a switched-off provider is passed over for the first one that is on", () => {
    expect(reviewModelArgs("implement", "claude", {
      home: "/home/r", modelChoices: { opus: {} } as never, model: { default: "opus" },
      providers: { off: PROVIDERS.off!, plain: PROVIDERS.plain! },
    })).toEqual(["--review-model", "opus", "--review-tool", "claude", "--verify-model", "opus", "--verify-tool", "claude"]);
  });
});
