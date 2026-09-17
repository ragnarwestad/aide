// What a Check button actually finds out, and what it refuses to claim.
//
// The point of these tests is the LAST part: a question that could not
// be answered has to stay unanswered on the page. A check that quietly
// turned "I could not ask" into "no" would have a reader reinstalling
// something that was never broken.

import { describe, expect, test } from "bun:test";
import { checkTool, forgetChecks, lastChecks, recordCheck, stripAnsi, toolsWithFaults } from "../../src/serve/tool-check.ts";

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

  test("Claude Code answers from its own JSON", async () => {
    const run = fakeRun({
      ...preflight,
      "auth status": { stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' },
    });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBe(true);
    expect(entry.detail).toContain("claude.ai");
  });

  // Which account the board runs as, asked from the board's own
  // process — not from a terminal, whose login can be another one.
  test("Claude Code names the account and the plan it runs on", async () => {
    const run = fakeRun({
      ...preflight,
      "auth status": {
        stdout: JSON.stringify({
          loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
          orgName: "someone@example.com's Organization", subscriptionType: "max",
        }),
      },
    });
    expect(login(await checkTool("claude", opts(run))).detail).toBe("Yes (claude.ai) — someone@example.com, Max.");
  });

  test("an organization of its own is named beside the account", async () => {
    const run = fakeRun({
      ...preflight,
      "auth status": {
        stdout: JSON.stringify({
          loggedIn: true, authMethod: "claude.ai", email: "someone@example.com",
          orgName: "Example AS", subscriptionType: "team",
        }),
      },
    });
    expect(login(await checkTool("claude", opts(run))).detail).toBe(
      "Yes (claude.ai) — someone@example.com, Example AS, Team.",
    );
  });

  test("Claude Code says no, with the command to fix it", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: '{"loggedIn":false}' } });
    const entry = login(await checkTool("claude", opts(run)));
    expect(entry.ok).toBe(false);
    expect(entry.detail).toContain("claude auth login");
  });

  test("a shape Claude Code never printed is unanswered, not a failure", async () => {
    const run = fakeRun({ ...preflight, "auth status": { stdout: "who knows" } });
    expect(login(await checkTool("claude", opts(run))).ok).toBeNull();
  });

  test("Codex answers with its exit code and its one line", async () => {
    const run = fakeRun({ ...preflight, "login status": { stdout: "Logged in using ChatGPT\n" } });
    const entry = login(await checkTool("codex", opts(run)));
    expect(entry.ok).toBe(true);
    expect(entry.detail).toContain("ChatGPT");
  });

  test("Codex that is not logged in fails on the exit code", async () => {
    const run = fakeRun({ ...preflight, "login status": { code: 1, stdout: "Not logged in\n" } });
    expect(login(await checkTool("codex", opts(run))).ok).toBe(false);
  });

  // The rule, again: no command means no answer, never a guess from a
  // token file whose location the CLI is free to move.
  test("Copilot has no command for it and says so", async () => {
    const run = fakeRun(preflight);
    const entry = login(await checkTool("copilot", opts(run)));
    expect(entry.ok).toBeNull();
    expect(entry.detail).toContain("no command");
    expect(run.calls.length).toBe(1);
  });

  test("OpenCode answers through its providers, which are its credentials", async () => {
    const run = fakeRun({
      ...preflight,
      "opencode providers list": { stdout: "1 credentials\n" },
    });
    const entry = login(await checkTool("opencode", opts(run)));
    expect(entry.ok).toBe(true);
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
    const provider = check.extra.find((e) => e.question === "Is it logged in?")!;
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

describe("when a server runs the checks at all", () => {
  // The guard this file exists to keep. A default of "on" had every
  // served fixture in the suite spawn four real CLIs; a test that never
  // mentions these tools must not be able to start them.
  test("createServer runs nothing unless it was asked", async () => {
    const source = await Bun.file(
      new URL("../../src/serve/serve.ts", import.meta.url),
    ).text();
    // Asked for by one flag and nothing else: no environment sniffing,
    // which is what failed — `BUN_TEST` was not set the way it was
    // assumed to be.
    expect(source).toContain("if (opts.checkToolsOnStart)");
    expect(source).not.toContain("BUN_TEST");
  });

  test("the CLI is the one caller that asks", async () => {
    const cli = await Bun.file(new URL("../../src/serve/cli.ts", import.meta.url)).text();
    expect(cli).toContain("checkToolsOnStart: true");
  });
});
