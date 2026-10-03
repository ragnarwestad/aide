// What a Check button actually finds out, and what it refuses to claim.
//
// The point of these tests is the LAST part: a question that could not
// be answered has to stay unanswered on the page. A check that quietly
// turned "I could not ask" into "no" would have a reader reinstalling
// something that was never broken.

import { describe, expect, test } from "bun:test";
import {
  checkTool, forgetChecks, lastChecks, recordCheck, setConfiguredTools, stripAnsi, toolRechecker, toolsWithFaults,
} from "../../../src/serve/tool-check.ts";

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
  return Object.assign(run as never as typeof import("../../../src/serve/land-branch/run-script.ts").runScript, { calls });
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

  test("only OpenCode is asked whether its models still exist", async () => {
    const run = fakeRun({
      "aide-preflight": { stdout: "found\n" },
      "auth status": { stdout: '{"loggedIn":true}' },
      "login status": { stdout: "Logged in using ChatGPT\n" },
    });
    for (const tool of ["claude", "codex", "copilot"] as const) {
      const check = await checkTool(tool, opts(run));
      expect(check.extra.some((e) => e.question.includes("models"))).toBe(false);
    }
  });

  test("a CLI that is not installed is asked nothing at all", async () => {
    // Asking would report "not logged in" for what is really "not
    // installed", which sends a reader to fix the wrong thing.
    const run = fakeRun({ "aide-preflight": { stdout: "Codex CLI is NOT installed\n" } });
    const check = await checkTool("codex", opts(run));
    expect(check.found).toBe(false);
    expect(check.extra).toEqual([]);
    expect(run.calls.length).toBe(1);
  });
});

describe("whether a tool is logged in", () => {
  const preflight = { "aide-preflight": { stdout: "found\n" } };
  const login = (check: Awaited<ReturnType<typeof checkTool>>) =>
    check.extra.find((e) => e.question === "Is it logged in?")!;
  const claudeStatus = (status: Record<string, unknown>) =>
    fakeRun({ ...preflight, "auth status": { stdout: JSON.stringify(status) } });

  test("Claude Code answers from its own JSON, with how it is logged in (AC-9)", async () => {
    const entry = login(await checkTool("claude", opts(claudeStatus({ loggedIn: true, authMethod: "claude.ai" }))));
    expect(entry.ok).toBe(true);
    expect(entry.answer).toEqual({ key: "login.inWith", values: { method: "claude.ai" } });
    expect(entry.detail).toBe("");
  });

  // Which account the board runs as, asked from the board's own
  // process — not from a terminal, whose login can be another one.
  test("Claude Code names the account and the plan it runs on (AC-9)", async () => {
    const run = claudeStatus({
      loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
      orgName: "someone@example.com's Organization", subscriptionType: "max",
    });
    expect(login(await checkTool("claude", opts(run))).answer).toEqual({
      key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Max" },
    });
  });

  test("an organization of its own is named beside the account (AC-9)", async () => {
    const run = claudeStatus({
      loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
      orgName: "Example AS", subscriptionType: "team",
    });
    expect(login(await checkTool("claude", opts(run))).answer).toEqual({
      key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Example AS, Team" },
    });
  });

  test("an account with no method named is logged in as that account (AC-9)", async () => {
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

  test("Claude Code says it is not logged in, with the command to fix it (AC-10)", async () => {
    const entry = login(await checkTool("claude", opts(claudeStatus({ loggedIn: false }))));
    expect(entry.ok).toBe(false);
    expect(entry.problem).toBe("not logged in");
    expect(entry.answer).toEqual({ key: "login.out", values: { command: "claude auth login" } });
  });

  test("a shape Claude Code never printed is unanswered, and says which command (AC-11)", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: "who knows" } });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBeNull();
    expect(entry.answer).toEqual({ key: "login.unreadable", values: { command: "claude auth status" } });
  });

  test("a status command that does not finish is unanswered, and says which command (AC-11)", async () => {
    const run = fakeRun({ ...preflight, "auth status": { timedOut: true, code: 143 } });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBeNull();
    expect(entry.answer).toEqual({ key: "login.timedOut", values: { command: "claude auth status" } });
  });

  test("Codex answers with its exit code, and how it is logged in from its one line (AC-9)", async () => {
    const run = fakeRun({ ...preflight, "login status": { stdout: "Logged in using ChatGPT\n" } });
    const entry = login(await checkTool("codex", opts(run)));
    expect(entry.ok).toBe(true);
    expect(entry.answer).toEqual({ key: "login.inWith", values: { method: "ChatGPT" } });
  });

  test("Codex that is not logged in fails on the exit code, with the command to fix it (AC-10)", async () => {
    const run = fakeRun({ ...preflight, "login status": { code: 1, stdout: "Not logged in\n" } });
    const entry = login(await checkTool("codex", opts(run)));
    expect(entry.ok).toBe(false);
    expect(entry.answer).toEqual({ key: "login.out", values: { command: "codex login" } });
  });

  // The rule, again: no command means no answer, never a guess from a
  // token file whose location the CLI is free to move.
  test("Copilot has no command for it and says so (AC-11)", async () => {
    const run = fakeRun(preflight);
    const entry = login(await checkTool("copilot", opts(run)));
    expect(entry.ok).toBeNull();
    expect(entry.answer).toEqual({ key: "login.noCommand", values: { tool: "Copilot" } });
    expect(run.calls.length).toBe(1);
  });

  test("OpenCode answers through its providers, which are its credentials (AC-9)", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { stdout: "1 credentials\n" },
    });
    const entry = login(await checkTool("opencode", opts(run)));
    expect(entry.ok).toBe(true);
    expect(entry.answer).toEqual({ key: "login.in" });
  });
});

describe("checkTool for OpenCode", () => {
  const preflight = { "aide-preflight opencode": { stdout: "OpenCode found (1.18.31)\n" } };

  test("no provider logged in is a failure, with the command to fix it (AC-10)", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { stdout: "Credentials\n0 credentials\n" },
    });
    const check = await checkTool("opencode", opts(run, { configuredModels: ["opencode/x"] }));
    const provider = check.extra.find((e) => e.question === "Is it logged in?")!;
    expect(provider.ok).toBe(false);
    expect(provider.answer).toEqual({ key: "login.out", values: { command: "opencode providers login" } });
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
  test("a question that could not be asked stays unanswered, never a failure (AC-11)", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { code: 1 },
      "opencode models": { code: 1 },
    });
    const check = await checkTool("opencode", opts(run, { configuredModels: ["opencode/here"] }));
    for (const entry of check.extra) {
      expect(entry.ok).toBeNull();
    }
    expect(check.extra.find((e) => e.question === "Is it logged in?")!.answer).toEqual({
      key: "login.unreadable", values: { command: "opencode providers list" },
    });
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

describe("the commands a check ran", () => {
  test("every command is recorded, in order, exactly as it ran", async () => {
    const run = fakeRun({
      "aide-preflight": { stdout: "found\n" },
      "opencode providers list": { stdout: "1 credentials\n" },
      "opencode models": { stdout: "opencode/here\n" },
    });
    const check = await checkTool("opencode", opts(run, { configuredModels: ["opencode/here"] }));
    expect(check.commands).toEqual([
      "aide-preflight opencode",
      "opencode providers list",
      "opencode models",
    ]);
  });

  test("a check that did not finish still says what it tried to run", async () => {
    const run = fakeRun({ "aide-preflight": { timedOut: true } });
    const check = await checkTool("claude", opts(run));
    expect(check.commands).toEqual(["aide-preflight claude"]);
  });

  test("a tool that is not installed shows the one command that found that out", async () => {
    const run = fakeRun({ "aide-preflight": { stdout: "Codex CLI is NOT installed\n" } });
    const check = await checkTool("codex", opts(run));
    expect(check.commands).toEqual(["aide-preflight codex"]);
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

describe("what the header notice is told", () => {
  test("a question that came back no is a fault; one nobody could ask is not", () => {
    forgetChecks();
    recordCheck({
      tool: "copilot",
      at: "2026-09-16T08:00:00.000Z",
      found: true,
      lines: [],
      // Copilot has no command that reports a login, so this is null.
      // A banner on it would be on permanently.
      extra: [{ question: "Is it logged in?", ok: null, detail: "no command" }],
    });
    expect(toolsWithFaults()).toEqual([]);

    recordCheck({
      tool: "opencode",
      at: "2026-09-16T08:00:00.000Z",
      found: true,
      lines: [],
      extra: [{ question: "Is it logged in?", ok: false, detail: "none" }],
    });
    expect(toolsWithFaults()).toEqual([{ tool: "opencode", problems: ["is it logged in"] }]);
    forgetChecks();
  });

  test("a CLI that is not installed is a fault on its own", () => {
    forgetChecks();
    recordCheck({ tool: "codex", at: "2026-09-16T08:00:00.000Z", found: false, lines: [], extra: [] });
    expect(toolsWithFaults()).toEqual([{ tool: "codex", problems: ["not installed"] }]);
    forgetChecks();
  });
});

// The notice is for a login a run can actually use: a tool nobody has
// set a model for would only ever be noise, and a fault is said as what
// is wrong rather than as the question that found it.
describe("what the header notice says, and about which tools", () => {
  const faulty = (tool: "claude" | "codex" | "opencode", problem?: string) =>
    recordCheck({
      tool,
      at: "2026-09-17T08:00:00.000Z",
      found: true,
      lines: [],
      extra: [{ question: "Is it logged in?", ok: false, detail: "…", ...(problem ? { problem } : {}) }],
    });

  test("only a tool a model is configured for is named", () => {
    forgetChecks();
    setConfiguredTools(() => ["claude"]);
    faulty("claude", "the login in use is another account's");
    faulty("opencode");
    expect(toolsWithFaults()).toEqual([{ tool: "claude", problems: ["the login in use is another account's"] }]);
    forgetChecks();
  });

  test("with no configuration known, every faulty tool is named as before", () => {
    forgetChecks();
    faulty("opencode");
    expect(toolsWithFaults()).toEqual([{ tool: "opencode", problems: ["is it logged in"] }]);
    forgetChecks();
  });

  test("Claude Code's two logins are said as what is wrong", async () => {
    forgetChecks();
    const run = fakeRun({
      "aide-preflight": { stdout: "found\n" },
      "auth status": {
        stdout: JSON.stringify({
          loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
          orgName: "someone@example.com's Organization", subscriptionType: "team",
        }),
      },
    });
    recordCheck(await checkTool("claude", opts(run)));
    expect(toolsWithFaults()).toEqual([{ tool: "claude", problems: ["the login in use is another account's"] }]);
    forgetChecks();
  });
});

// Checked again for the tool a waiting job is about to run on, so the
// notice describes the login a run will use now rather than the one the
// board found when it started — the login that changed under a running
// board is the case that cost seven runs.
describe("the check before a job starts", () => {
  test("asks for each tool once, and not again within the minute", async () => {
    forgetChecks();
    let clock = Date.parse("2026-09-17T08:00:00.000Z");
    const asked: string[] = [];
    const recheck = toolRechecker(() => [], {
      now: () => new Date(clock),
      check: async (tool) => {
        asked.push(tool);
        return { tool, at: new Date(clock).toISOString(), found: true, lines: [], extra: [] };
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
    forgetChecks();
  });
});

describe("when a server runs the checks at all", () => {
  // The guard this file exists to keep. A default of "on" had every
  // served fixture in the suite spawn four real CLIs; a test that never
  // mentions these tools must not be able to start them.
  test("createServer runs nothing unless it was asked", async () => {
    const source = await Bun.file(
      new URL("../../../src/serve/serve.ts", import.meta.url),
    ).text();
    // Asked for by one flag and nothing else: no environment sniffing,
    // which is what failed — `BUN_TEST` was not set the way it was
    // assumed to be.
    expect(source).toContain("if (opts.checkToolsOnStart)");
    // The check before a job starts is behind the same one flag.
    expect(source).toMatch(/opts\.checkToolsOnStart \? toolRechecker\(/);
    expect(source).not.toContain("BUN_TEST");
  });

  test("the CLI is the one caller that asks", async () => {
    const cli = await Bun.file(new URL("../../../src/serve/cli.ts", import.meta.url)).text();
    expect(cli).toContain("checkToolsOnStart: true");
  });
});
