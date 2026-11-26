// What the Installation tab's check actually finds out, and what it refuses to claim.
//
// The point of these tests is the LAST part: a question that could not
// be answered has to stay unanswered on the page. A check that quietly
// turned "I could not ask" into "no" would have a reader reinstalling
// something that was never broken.

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkAllTools, checkTool, createToolReadings, stripAnsi, toolRechecker,
} from "../../../src/serve/tool-check.ts";
import { OTHER_ACCOUNT_REMOVAL } from "../../../src/render/pages/settings-page/tools.ts";
import { UNANSWERED_FOR_MS } from "../../../src/render/ui/faults/unanswered.ts";

// A store of the test's own, as each server has its own.
let readings = createToolReadings();
beforeEach(() => {
  readings = createToolReadings();
});

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

const ESC = String.fromCharCode(27);

/** A stand-in for `runScript`, answering by the command it was given. */
function fakeRun(answers: Record<string, Partial<RunResult>>) {
  const calls: string[][] = [];
  const envs: Record<string, string>[] = [];
  const run = async (argv: string[], _cwd?: string, _timeout?: number, _owner?: string, extraEnv?: Record<string, string>): Promise<RunResult> => {
    calls.push(argv);
    envs.push(extraEnv ?? {});
    const key = Object.keys(answers).find((k) => argv.join(" ").includes(k));
    const answer = key ? answers[key]! : {};
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...answer };
  };
  return Object.assign(run as never as typeof import("../../../src/serve/process").runScript, { calls, envs });
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
  test("it runs the preflight's facts for that tool and reads what the installation is missing (AC-7, AC-9)", async () => {
    const run = fakeRun({
      "aide-preflight": {
        stdout: [
          "cli\tfound", "place\tskills\t~/.claude/skills/\texists", "place\trules\t~/.claude/rules/\tmissing",
          "place\tscripts\t~/.local/bin/\tmissing", "files\tbehind",
        ].join("\n") + "\n",
      },
    });
    const check = await checkTool("claude", opts(run));
    expect(run.calls[0]).toEqual(["aide-preflight", "--facts", "claude"]);
    expect(check.found).toBe(true);
    expect(check.missing).toEqual(["rules", "scripts"]);
    expect(check.behind).toBe(true);
    expect(check.at).toBe("2026-09-16T08:30:00.000Z");
  });

  test("a place's path is the one the preflight reported", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tfound\nplace\tinstructions\t/srv/config/opencode/AGENTS.md\tmissing\n" } });
    const check = await checkTool("opencode", opts(run));
    expect(check.paths).toEqual({ instructions: "/srv/config/opencode/AGENTS.md" });
  });

  test("files that match, or that cannot be measured, are not behind", async () => {
    for (const files of ["match", "unknown"]) {
      const run = fakeRun({ "aide-preflight": { stdout: `cli\tfound\nfiles\t${files}\n` } });
      const check = await checkTool("claude", opts(run));
      expect(check.behind).toBe(false);
      expect(check.missing).toEqual([]);
    }
  });

  test("a preflight that runs from the directory it is given is that one (AC-7)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-beside-"));
    writeFileSync(join(dir, "aide-preflight"), "");
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tfound\n" } });
    await checkTool("claude", { run, scriptDir: dir, now: () => new Date("2026-09-16T08:30:00.000Z") });
    expect(run.calls[0]).toEqual([join(dir, "aide-preflight"), "--facts", "claude"]);
  });

  test("a CLI the preflight says is missing is not found, and is asked nothing (AC-4)", async () => {
    const run = fakeRun({ "aide-preflight --facts codex": { stdout: "cli\tmissing\nfiles\tmatch\n" } });
    const check = await checkTool("codex", opts(run));
    expect(check.found).toBe(false);
    expect(check.extra).toEqual([]);
    expect(run.calls.length).toBe(1);
  });

  test("a check that does not finish says so instead of reporting a result", async () => {
    const run = fakeRun({ "aide-preflight --facts opencode": { timedOut: true, code: 143 } });
    const check = await checkTool("opencode", opts(run));
    expect(check.error).toBe("The check did not finish in time.");
    expect(check.extra).toEqual([]);
  });

  // An older preflight answers --facts with its banner and then "Unknown tool".
  test.each([
    ["an old preflight", { code: 1, stdout: "🔎 aide preflight\n=================\n\n❌ Unknown tool: --facts (use claude, copilot, codex, opencode or all)\n" }, "❌ Unknown tool: --facts (use claude, copilot, codex, opencode or all)"],
    ["one that crashed with no output", { code: 1, stdout: "", stderr: "" }, undefined],
    ["one that printed no cli line", { code: 0, stdout: "files\tmatch\n" }, "files\tmatch"],
  ])("%s is a check that gave no answer the board can read, never a CLI that is not installed (AC-9)", async (_name, answer, last) => {
    const run = fakeRun({ "aide-preflight": answer });
    const check = await checkTool("codex", opts(run));
    expect(check.found).toBe(false);
    expect(check.error).toContain("The check gave no answer the board can read");
    if (last) expect(check.error).toContain(last);
    expect(check.extra).toEqual([]);
    expect(run.calls.length).toBe(1);
  });

  test.each(["claude", "codex", "opencode"] as const)("%s's check asks nothing about models (AC-8)", async (tool) => {
    const run = fakeRun({
      "aide-preflight": { stdout: "cli\tfound\n" },
      "auth status": { stdout: '{"loggedIn":true}' },
      "login status": { stdout: "Logged in using ChatGPT\n" },
      "opencode auth list": { stdout: "1 credentials\n" },
    });
    const check = await checkTool(tool, opts(run));
    expect(check.extra.some((e) => e.question.toLowerCase().includes("models"))).toBe(false);
    expect(run.calls.some((argv) => /\bmodels\b/.test(argv.join(" ")))).toBe(false);
  });
});

describe("whether a provider is logged in", () => {
  const preflight = { "aide-preflight": { stdout: "cli\tfound\n" } };
  const PROVIDERS = {
    Claude: { name: "Claude", tool: "claude" as const },
    "Claude-2": { name: "Claude-2", tool: "claude" as const, configDir: "~/.claude-2" },
    Codex: { name: "Codex", tool: "codex" as const },
  };
  const withProviders = (run: ReturnType<typeof fakeRun>) => opts(run, { providers: () => PROVIDERS, home: "/home/x" });
  const statusIn = (ok: boolean) => JSON.stringify(ok ? { loggedIn: true, authMethod: "claude.ai", email: "a@b.no", subscriptionType: "max" } : { loggedIn: false });

  test("each provider of the tool is asked once, with its own folder, and its entry names it (AC-7, AC-5)", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: statusIn(true) } });
    const check = await checkTool("claude", withProviders(run));
    const asked = run.calls.map((c, i) => ({ argv: c.join(" "), env: run.envs[i] })).filter((c) => c.argv.includes("auth status"));
    expect(asked).toEqual([
      { argv: "claude auth status", env: {} },
      { argv: "claude auth status", env: { CLAUDE_CONFIG_DIR: "/home/x/.claude-2" } },
    ]);
    expect(check.extra.map((e) => e.provider)).toEqual(["Claude", "Claude-2"]);
  });

  test("a Claude login names its plan, from the subscription Claude Code reports", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: statusIn(true) } });
    const check = await checkTool("claude", opts(run, { providers: () => ({ Claude: PROVIDERS.Claude }), home: "/home/x" }));
    expect(check.extra[0]!.plan).toBe("Max");
  });

  test("a switched-off provider is not asked; one with a binary path is asked through that program", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: statusIn(true) } });
    const providers = () => ({
      Claude: { ...PROVIDERS.Claude, enabled: false as const },
      "Claude-2": { ...PROVIDERS["Claude-2"], binary: "~/bin/claude-next" },
    });
    const check = await checkTool("claude", opts(run, { providers, home: "/home/x" }));
    expect(run.calls.map((c) => c.join(" ")).filter((c) => c.includes("auth status"))).toEqual(["/home/x/bin/claude-next auth status"]);
    expect(check.extra.map((e) => e.provider)).toEqual(["Claude-2"]);
  });

  test("a provider that is not logged in is a fault that names it, and says its own command (AC-7, AC-4)", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: statusIn(false) } });
    const check = await checkTool("claude", opts(run, { providers: () => ({ "Claude-2": PROVIDERS["Claude-2"] }), home: "/home/x" }));
    expect(check.extra[0]!.answer).toEqual({ key: "login.out", values: { command: "CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login" } });
    readings.recordCheck(check);
    expect(readings.toolsWithFaults()).toEqual([{ tool: "claude", faults: [
      { key: "tools.notLoggedIn", values: { who: "Claude-2", command: "CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login" } },
    ] }]);
  });

  test("a tool with no provider is asked about its own login, with no variable, as before (AC-7)", async () => {
    const run = fakeRun({ ...preflight, "login status": { stdout: "Logged in using ChatGPT\n" } });
    const check = await checkTool("codex", opts(run, { providers: () => ({ Claude: PROVIDERS.Claude }) }));
    const asked = run.calls.findIndex((c) => c.join(" ").includes("login status"));
    expect(run.envs[asked]).toEqual({});
    expect(check.extra).toHaveLength(1);
    expect(check.extra[0]!.provider).toBeUndefined();
  });

  test("the check before a waiting job asks every provider of that tool (AC-7)", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: statusIn(true) } });
    const recheck = toolRechecker(readings, { ...withProviders(run) });
    await recheck(["claude"]);
    expect(run.calls.filter((c) => c.join(" ").includes("auth status"))).toHaveLength(2);
  });

  test("a login end date is kept as an ISO time, from a time string or a number (AC-3)", async () => {
    const ends = async (value: unknown) => {
      const run = fakeRun({ ...preflight, "auth status": { stdout: JSON.stringify({ loggedIn: true, loginExpiresAt: value }) } });
      return (await checkTool("claude", opts(run))).extra[0]!.ends;
    };
    expect(await ends("2026-12-01T09:00:00Z")).toBe("2026-12-01T09:00:00.000Z");
    expect(await ends(Date.parse("2026-12-01T09:00:00Z"))).toBe("2026-12-01T09:00:00.000Z");
    expect(await ends(Date.parse("2026-12-01T09:00:00Z") / 1000)).toBe("2026-12-01T09:00:00.000Z");
  });

  test("an answer with no end date, or one that is not a time, shows none (AC-3)", async () => {
    const ends = async (status: Record<string, unknown>) => {
      const run = fakeRun({ ...preflight, "auth status": { stdout: JSON.stringify({ loggedIn: true, ...status }) } });
      return (await checkTool("claude", opts(run))).extra[0]!.ends;
    };
    expect(await ends({})).toBeUndefined();
    expect(await ends({ loginExpiresAt: "someday" })).toBeUndefined();
    expect(await ends({ loginExpiresAt: { at: 1 } })).toBeUndefined();
  });
});

describe("a check for one provider", () => {
  const PROVIDERS = {
    Claude: { name: "Claude", tool: "claude" as const },
    "Claude-2": { name: "Claude-2", tool: "claude" as const, configDir: "~/.claude-2" },
  };
  const loggedIn = { "auth status": { stdout: JSON.stringify({ loggedIn: true }) } };
  const asked = (run: ReturnType<typeof fakeRun>) =>
    run.calls.map((c, i) => ({ argv: c.join(" "), env: run.envs[i] })).filter((c) => c.argv.includes("auth status"));

  test("only that provider is asked, with its own folder, though the tool has others (AC-2, AC-4)", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tfound\n" }, ...loggedIn });
    const check = await checkTool("claude", opts(run, { provider: PROVIDERS["Claude-2"], providers: () => PROVIDERS, home: "/home/x" }));
    expect(asked(run)).toEqual([{ argv: "claude auth status", env: { CLAUDE_CONFIG_DIR: "/home/x/.claude-2" } }]);
    expect(check.extra.map((e) => e.provider)).toEqual(["Claude-2"]);
  });

  test("a switched-off provider is still asked (AC-2)", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tfound\n" }, ...loggedIn });
    const check = await checkTool("claude", opts(run, { provider: { ...PROVIDERS.Claude, enabled: false }, home: "/home/x" }));
    expect(asked(run)).toHaveLength(1);
    expect(check.extra.map((e) => e.provider)).toEqual(["Claude"]);
  });

  test("with the CLI missing, a provider with a binary path is asked through that program, and the CLI stays not found (AC-3)", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tmissing\n" }, ...loggedIn });
    const provider = { ...PROVIDERS["Claude-2"], binary: "~/bin/claude-next" };
    const check = await checkTool("claude", opts(run, { provider, home: "/home/x" }));
    expect(asked(run)).toEqual([{ argv: "/home/x/bin/claude-next auth status", env: { CLAUDE_CONFIG_DIR: "/home/x/.claude-2" } }]);
    expect(check.found).toBe(false);
    expect(check.extra.map((e) => e.provider)).toEqual(["Claude-2"]);
  });

  test("with the CLI missing, a provider with no binary path is asked nothing (AC-3)", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tmissing\n" }, ...loggedIn });
    const check = await checkTool("claude", opts(run, { provider: PROVIDERS["Claude-2"], home: "/home/x" }));
    expect(run.calls).toHaveLength(1);
    expect(check.extra).toEqual([]);
  });
});

describe("whether a tool is logged in", () => {
  const preflight = { "aide-preflight": { stdout: "cli\tfound\n" } };
  const login = (check: Awaited<ReturnType<typeof checkTool>>) =>
    check.extra.find((e) => e.question === "Is it logged in?")!;
  const claudeStatus = (status: Record<string, unknown>) =>
    fakeRun({ ...preflight, "auth status": { stdout: JSON.stringify(status) } });

  test("Claude Code answers from its own JSON, with how it is logged in", async () => {
    const entry = login(await checkTool("claude", opts(claudeStatus({ loggedIn: true, authMethod: "claude.ai" }))));
    expect(entry.ok).toBe(true);
    expect(entry.answer).toEqual({ key: "login.inWith", values: { method: "claude.ai" } });
    expect(entry.detail).toBe("");
  });

  // Which account the board runs as, asked from the board's own
  // process — not from a terminal, whose login can be another one.
  test("Claude Code names the account and the plan it runs on", async () => {
    const run = claudeStatus({
      loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
      orgName: "someone@example.com's Organization", subscriptionType: "max",
    });
    expect(login(await checkTool("claude", opts(run))).answer).toEqual({
      key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Max" },
    });
  });

  test("an organization of its own is named beside the account", async () => {
    const run = claudeStatus({
      loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
      orgName: "Example AS", subscriptionType: "team",
    });
    expect(login(await checkTool("claude", opts(run))).answer).toEqual({
      key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Example AS, Team" },
    });
  });

  test("an account with no method named is logged in as that account", async () => {
    const run = claudeStatus({ loggedIn: true, email: "someone@example.com" });
    expect(login(await checkTool("claude", opts(run))).answer).toEqual({
      key: "login.inAs", values: { account: "someone@example.com" },
    });
  });

  // `claude auth status` reads the address from one file and the plan
  // from the stored login itself. When the two are different logins —
  // an old one left behind after `claude auth login` wrote a new one
  // elsewhere — it names one account with another's plan, and every
  // run spends the account that is not named. A personal organization
  // never has an organization plan, so the pair says it.
  test("an organization plan on a personal account is flagged as two logins, after the answer", async () => {
    const run = claudeStatus({
      loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
      orgName: "someone@example.com's Organization", subscriptionType: "team",
    });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBe(false);
    expect(entry.answer).toEqual({
      key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Team" },
    });
    expect(entry.detail).toBe(
      "A Team plan does not belong to a personal account: the stored login is probably another account's " +
        "than the one named here, and runs use that one. On macOS it lives in the keychain: remove it with `security delete-generic-password -s \"Claude Code-credentials\"` and check again.",
    );
  });

  test("Claude Code says it is not logged in, with the command to fix it", async () => {
    const entry = login(await checkTool("claude", opts(claudeStatus({ loggedIn: false }))));
    expect(entry.ok).toBe(false);
    expect(entry.problem).toBe("not logged in");
    expect(entry.answer).toEqual({ key: "login.out", values: { command: "claude auth login" } });
  });

  test("a shape Claude Code never printed is unanswered, and says which command", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: "who knows" } });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBeNull();
    expect(entry.answer).toEqual({ key: "login.unreadable", values: { command: "claude auth status" } });
  });

  test("a status command that does not finish is unanswered, and says which command", async () => {
    const run = fakeRun({ ...preflight, "auth status": { timedOut: true, code: 143 } });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBeNull();
    expect(entry.answer).toEqual({ key: "login.timedOut", values: { command: "claude auth status" } });
  });

  test("Codex answers with its exit code, and how it is logged in from its one line", async () => {
    const run = fakeRun({ ...preflight, "login status": { stdout: "Logged in using ChatGPT\n" } });
    const entry = login(await checkTool("codex", opts(run)));
    expect(entry.ok).toBe(true);
    expect(entry.answer).toEqual({ key: "login.inWith", values: { method: "ChatGPT" } });
  });

  test("Codex that is not logged in fails on the exit code, with the command to fix it", async () => {
    const run = fakeRun({ ...preflight, "login status": { code: 1, stdout: "Not logged in\n" } });
    const entry = login(await checkTool("codex", opts(run)));
    expect(entry.ok).toBe(false);
    expect(entry.answer).toEqual({ key: "login.out", values: { command: "codex login" } });
  });

  test("OpenCode answers through its providers, which are its credentials", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode auth list": { stdout: "1 credentials\n" },
    });
    const entry = login(await checkTool("opencode", opts(run)));
    expect(entry.ok).toBe(true);
    expect(entry.answer).toEqual({ key: "login.in" });
  });
});

describe("checkTool for OpenCode", () => {
  const preflight = { "aide-preflight --facts opencode": { stdout: "cli\tfound\n" } };

  test("no provider logged in is a failure, with the command to fix it", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode auth list": { stdout: "Credentials\n0 credentials\n" },
    });
    const check = await checkTool("opencode", opts(run));
    const provider = check.extra.find((e) => e.question === "Is it logged in?")!;
    expect(provider.ok).toBe(false);
    expect(provider.answer).toEqual({ key: "login.out", values: { command: "opencode auth login" } });
  });

  test("OpenCode 2's wording for no login is a failure too", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode auth list": { stdout: "No authenticated integrations\n" },
    });
    const check = await checkTool("opencode", opts(run));
    const provider = check.extra.find((e) => e.question === "Is it logged in?")!;
    expect(provider.ok).toBe(false);
    expect(provider.answer).toEqual({ key: "login.out", values: { command: "opencode auth login" } });
  });

  // The rule this file exists for.
  test("a question that could not be asked stays unanswered, never a failure", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode auth list": { code: 1 },
    });
    const check = await checkTool("opencode", opts(run));
    for (const entry of check.extra) {
      expect(entry.ok).toBeNull();
    }
    expect(check.extra.find((e) => e.question === "Is it logged in?")!.answer).toEqual({
      key: "login.unreadable", values: { command: "opencode auth list" },
    });
  });
});

describe("the check at start", () => {
  test("it checks Claude Code, Codex and OpenCode only, never Copilot (AC-25)", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "cli\tfound\n" } });
    await checkAllTools(readings, opts(run));
    expect(run.calls.filter((argv) => argv[0] === "aide-preflight").map((argv) => argv[2])).toEqual(["claude", "codex", "opencode"]);
    expect(Object.keys(readings.lastChecks()).sort()).toEqual(["claude", "codex", "opencode"]);
  });

  test("it records into the store it is given and no other (AC-1)", async () => {
    const other = createToolReadings();
    await checkAllTools(readings, opts(fakeRun({ "aide-preflight": { stdout: "cli\tfound\n" } })));
    expect(Object.keys(readings.lastChecks()).sort()).toEqual(["claude", "codex", "opencode"]);
    expect(other.lastChecks()).toEqual({});
  });
});

describe("what the page reads back", () => {
  test("a recorded check is what the next page load shows, per tool", () => {
    expect(readings.lastChecks()).toEqual({});
    readings.recordCheck({ tool: "codex", at: "2026-09-16T08:00:00.000Z", found: true, extra: [] });
    readings.recordCheck({ tool: "opencode", at: "2026-09-16T08:01:00.000Z", found: true, extra: [] });
    expect(Object.keys(readings.lastChecks()).sort()).toEqual(["codex", "opencode"]);
    // A second check for the same tool replaces the first rather than
    // piling up: the page shows the latest answer, not a history.
    readings.recordCheck({ tool: "codex", at: "2026-09-16T09:00:00.000Z", found: false, extra: [] });
    expect(readings.lastChecks().codex?.found).toBe(false);
  });
});

describe("what the header notice is told", () => {
  test("a question that came back no is a fault; one nobody could ask is not", () => {
    readings.recordCheck({
      tool: "codex",
      at: "2026-09-16T08:00:00.000Z",
      found: true,
      // A tool with no command that reports a login answers null.
      // A banner on it would be on permanently.
      extra: [{ question: "Is it logged in?", ok: null, detail: "no command" }],
    });
    expect(readings.toolsWithFaults()).toEqual([]);

    readings.recordCheck({
      tool: "opencode",
      at: "2026-09-16T08:00:00.000Z",
      found: true,
      extra: [{ question: "Is it logged in?", ok: false, detail: "none" }],
    });
    expect(readings.toolsWithFaults()).toEqual([{ tool: "opencode", faults: [
      { key: "tools.notLoggedIn", values: { who: "OpenCode", command: "opencode auth login" } },
    ] }]);
  });

  test("a place missing and files behind are no fault in the header (AC-10)", () => {
    readings.recordCheck({
      tool: "codex", at: "2026-09-16T08:00:00.000Z", found: true, missing: ["hooks"], behind: true,
      extra: [{ question: "Is it logged in?", ok: true, detail: "" }],
    });
    expect(readings.toolsWithFaults()).toEqual([]);
  });

  test("a check that did not finish keeps the last answer and says nothing until it has gone unanswered long enough", () => {
    const at = Date.parse("2026-11-26T08:00:00.000Z");
    readings.recordCheck({ tool: "claude", at: new Date(at - 60_000).toISOString(), found: true, extra: [] });
    const unfinished = { tool: "claude" as const, found: false, extra: [], error: "The check did not finish in time.", unfinished: true as const };
    readings.recordCheck({ ...unfinished, at: new Date(at).toISOString() });
    readings.recordCheck({ ...unfinished, at: new Date(at + 60_000).toISOString() });
    expect(readings.lastChecks().claude?.found).toBe(true);
    expect(readings.toolsWithFaults(at + UNANSWERED_FOR_MS - 1)).toEqual([]);
    expect(readings.toolsWithFaults(at + UNANSWERED_FOR_MS)).toEqual([
      { tool: "claude", faults: [{ key: "tools.unanswered", values: { tool: "Claude Code", minutes: 15 } }] },
    ]);
    readings.recordCheck({ tool: "claude", at: new Date(at + UNANSWERED_FOR_MS).toISOString(), found: true, extra: [] });
    expect(readings.toolsWithFaults(at + UNANSWERED_FOR_MS)).toEqual([]);
  });

  test("a CLI that is not installed is a fault on its own", () => {
    readings.recordCheck({ tool: "codex", at: "2026-09-16T08:00:00.000Z", found: false, extra: [] });
    expect(readings.toolsWithFaults()).toEqual([{ tool: "codex", faults: [{ key: "tools.notInstalled", values: { tool: "Codex" } }] }]);
  });
});

// The notice is for a login a run can actually use: a tool nobody has
// set a model for would only ever be noise, and a fault is said as what
// is wrong rather than as the question that found it.
describe("what the header notice says, and about which tools", () => {
  const faulty = (tool: "claude" | "codex" | "opencode", problem?: string) =>
    readings.recordCheck({
      tool,
      at: "2026-09-17T08:00:00.000Z",
      found: true,
      extra: [{ question: "Is it logged in?", ok: false, detail: "…", ...(problem ? { problem } : {}) }],
    });

  test("only a tool a model is configured for is named", () => {
    readings.setConfiguredTools(() => ["claude"]);
    faulty("claude", "the login in use is another account's");
    faulty("opencode");
    expect(readings.toolsWithFaults().map(({ tool, faults }) => [tool, faults.map((f) => f.key)])).toEqual([["claude", ["tools.otherAccount"]]]);
  });

  test("with no configuration known, every faulty tool is named as before", () => {
    faulty("opencode");
    expect(readings.toolsWithFaults().map(({ tool, faults }) => [tool, faults.map((f) => f.key)])).toEqual([["opencode", ["tools.notLoggedIn"]]]);
  });

  test("Claude Code's two logins are said as what is wrong", async () => {
    const run = fakeRun({
      "aide-preflight": { stdout: "cli\tfound\n" },
      "auth status": {
        stdout: JSON.stringify({
          loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
          orgName: "someone@example.com's Organization", subscriptionType: "team",
        }),
      },
    });
    readings.recordCheck(await checkTool("claude", opts(run)));
    expect(readings.toolsWithFaults()).toEqual([{ tool: "claude", faults: [
      { key: "tools.otherAccount", values: { who: "Claude Code", command: OTHER_ACCOUNT_REMOVAL } },
    ] }]);
  });
});

// Checked again for the tool a waiting job is about to run on, so the
// notice describes the login a run will use now rather than the one the
// board found when it started — the login that changed under a running
// board is the case that cost seven runs.
describe("the check before a job starts", () => {
  test("the round's scripted stand-in is not sent to installation checks", async () => {
    const asked: string[] = [];
    const recheck = toolRechecker(readings, { check: async (tool) => {
      asked.push(tool);
      return { tool, at: new Date().toISOString(), found: true, extra: [] };
    } });
    await recheck(["fake-claude" as never]);
    expect(asked).toEqual([]);
  });

  test("asks for each tool once, and not again within the minute (AC-3)", async () => {
    let clock = Date.parse("2026-09-17T08:00:00.000Z");
    const asked: string[] = [];
    const recheck = toolRechecker(readings, {
      now: () => new Date(clock),
      check: async (tool) => {
        asked.push(tool);
        return { tool, at: new Date(clock).toISOString(), found: true, extra: [] };
      },
    });
    await recheck(["claude", "claude", "codex"]);
    expect(asked.sort()).toEqual(["claude", "codex"]);
    clock += 30_000;
    await recheck(["claude"]);
    expect(asked).toHaveLength(2);
    clock += 31_000;
    await recheck(["claude"]);
    expect(asked).toEqual(expect.arrayContaining(["claude", "codex"]));
    expect(asked.filter((t) => t === "claude")).toHaveLength(2);
  });
  test("another store's fresh check neither stands in for nor suppresses this store's (AC-2)", async () => {
    const clock = Date.parse("2026-09-17T08:00:00.000Z");
    const other = createToolReadings();
    other.recordCheck({ tool: "claude", at: new Date(clock).toISOString(), found: true, extra: [] });
    const asked: string[] = [];
    const recheck = toolRechecker(readings, {
      now: () => new Date(clock + 1_000),
      check: async (tool) => {
        asked.push(tool);
        return { tool, at: new Date(clock + 1_000).toISOString(), found: false, extra: [] };
      },
    });
    await recheck(["claude"]);
    expect(asked).toEqual(["claude"]);
    expect(readings.lastChecks().claude?.found).toBe(false);
    expect(other.lastChecks().claude?.found).toBe(true);
  });
});

describe("when a server runs the checks at all", () => {
  // The guard this file exists to keep. A default of "on" had every
  // served fixture in the suite spawn four real CLIs; a test that never
  // mentions these tools must not be able to start them.
  test("createServer runs nothing unless it was asked", async () => {
    const read = (file: string) => Bun.file(new URL(`../../../src/serve/${file}`, import.meta.url)).text();
    const [serve, lifecycle, services] = await Promise.all([
      read("serve.ts"),
      read("create-server/lifecycle.ts"),
      read("create-server/services.ts"),
    ]);
    // Asked for by one flag and nothing else: no environment sniffing,
    // which is what failed — `BUN_TEST` was not set the way it was
    // assumed to be.
    expect(lifecycle).toContain("if (!opts.checkToolsOnStart) return;");
    // The check before a job starts is behind the same one flag.
    expect(services).toMatch(/opts\.checkToolsOnStart \? toolRechecker\(/);
    for (const source of [serve, lifecycle, services]) expect(source).not.toContain("BUN_TEST");
  });

  test("the CLI is the one caller that asks", async () => {
    const cli = await Bun.file(new URL("../../../src/serve/cli.ts", import.meta.url)).text();
    expect(cli).toContain("checkToolsOnStart: true");
  });
});
