// What the board reads of one provider: whether its tool starts, which
// version it prints, and its login — each asked with the provider's own
// folder, from the board's own process.

import { describe, expect, test } from "bun:test";
import { readProviderStatus } from "../../../src/serve/providers/status.ts";
import type { Provider } from "../../../src/queue/providers/index.ts";

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

/** A stand-in for `runScript`: answers by command, records the argv and the
 *  environment of each call, and throws for a binary it is told is missing. */
function fakeRun(answers: Record<string, Partial<RunResult>>, missing = false) {
  const calls: { argv: string; env: Record<string, string> }[] = [];
  const run = async (argv: string[], _cwd?: string, _timeout?: number, _owner?: string, extraEnv?: Record<string, string>): Promise<RunResult> => {
    calls.push({ argv: argv.join(" "), env: extraEnv ?? {} });
    if (missing) throw new Error("ENOENT: no such file or directory");
    const key = Object.keys(answers).find((k) => argv.join(" ").includes(k));
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...(key ? answers[key] : {}) };
  };
  return Object.assign(run as never as typeof import("../../../src/serve/land-branch/run-script.ts").runScript, { calls });
}

const CLAUDE_2: Provider = { name: "Claude-2", tool: "claude", configDir: "~/.claude-2" };
const base = (run: ReturnType<typeof fakeRun>) => ({
  run, scriptPath: (name: string) => name, now: () => new Date("2026-11-05T09:00:00.000Z"), home: "/home/x",
});

describe("reading a provider's status", () => {
  test("a tool that starts is installed, with the first line --version printed as its version (AC-1)", async () => {
    const run = fakeRun({
      "--version": { stdout: "2.1.318 (Claude Code)\nsecond line\n" },
      "auth status": { stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "a@b.no" }) },
    });
    const status = await readProviderStatus("Claude-2", CLAUDE_2, base(run));
    expect(status).toMatchObject({ key: "Claude-2", at: "2026-11-05T09:00:00.000Z", installed: true, version: "2.1.318 (Claude Code)" });
    expect(status.login?.answer).toEqual({ key: "login.inWithAs", values: { method: "claude.ai", account: "a@b.no" } });
  });

  test("a tool that cannot be started is not installed, and no login command is run (AC-1)", async () => {
    const run = fakeRun({}, true);
    const status = await readProviderStatus("Claude-2", CLAUDE_2, base(run));
    expect(status.installed).toBe(false);
    expect(status.login).toBeUndefined();
    expect(run.calls).toHaveLength(1);
  });

  test("the version and the login both run with the provider's folder in the environment (AC-5)", async () => {
    const run = fakeRun({ "--version": { stdout: "2.1.318\n" }, "auth status": { stdout: '{"loggedIn":false}' } });
    const status = await readProviderStatus("Claude-2", CLAUDE_2, base(run));
    expect(run.calls).toEqual([
      { argv: "claude --version", env: { CLAUDE_CONFIG_DIR: "/home/x/.claude-2" } },
      { argv: "claude auth status", env: { CLAUDE_CONFIG_DIR: "/home/x/.claude-2" } },
    ]);
    expect(status.login?.answer).toEqual({ key: "login.out", values: { command: "CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login" } });
  });
});
