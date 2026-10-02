// What a press of Check reads of an AI's usage, and what it refuses to
// claim. A usage the board could not read is never shown as "none", and
// the checks the board runs on its own read no usage at all.

import { describe, expect, test } from "bun:test";
import { checkTool, CHECKABLE_TOOLS, forgetChecks, recordCheck } from "../../../src/serve/tool-check.ts";
import {
  codexWindowName, lastUsage, parseClaudeUsage, readUsage, recordUsage, type UsageExchange,
} from "../../../src/serve/tool-usage";

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

const ESC = String.fromCharCode(27);
const AT = new Date("2026-10-02T19:00:00.000Z");

/** A stand-in for `runScript`, answering every command the same way. */
function fakeRun(answer: Partial<RunResult> = {}) {
  const calls: string[][] = [];
  const run = async (argv: string[]): Promise<RunResult> => {
    calls.push(argv);
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...answer };
  };
  return Object.assign(run as never as typeof import("../../../src/serve/land-branch/run-script.ts").runScript, { calls });
}

/** A stand-in for the app-server exchange: records what it was sent. */
function fakeExchange(reply: Awaited<ReturnType<UsageExchange>>) {
  const sent: { argv: string[]; messages: Record<string, unknown>[] }[] = [];
  const exchange: UsageExchange = async (argv, messages) => {
    sent.push({ argv, messages: messages as Record<string, unknown>[] });
    return reply;
  };
  return Object.assign(exchange, { sent });
}

const opts = (extra: Record<string, unknown> = {}) => ({
  scriptPath: (name: string) => name,
  now: () => AT,
  ...extra,
});

// Claude Code 2.1.288, 2026-10-02, trimmed.
const CLAUDE_SAMPLE = [
  "You are currently using your subscription to power your Claude Code usage",
  "",
  "Current session: 24% used · resets Oct 2 at 11:20pm (Europe/Oslo)",
  "Current week (all models): 33% used · resets Oct 8 at 6am (Europe/Oslo)",
  "Current week (Fable): 0% used · resets Oct 8 at 6am (Europe/Oslo)",
  "",
  "What's contributing to your limits usage?",
  "Last 24h · 1184 requests · 29 sessions",
  "  67% of your usage came from subagent-heavy sessions",
  "  Top skills: /aide-analyze 39%, /aide-implement 18%",
  "",
].join("\n");

// codex-cli 0.159.3, 2026-10-02, trimmed.
const CODEX_ANSWER = {
  id: 2,
  result: {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 51, windowDurationMins: 300, resetsAt: 1790978086 },
      secondary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1791051017 },
      planType: "plus",
    },
  },
};

describe("Claude's usage", () => {
  test("is read from claude -p /usage, and each window line is one window (AC-2)", async () => {
    const run = fakeRun({ stdout: CLAUDE_SAMPLE });
    const usage = await readUsage("claude", opts({ run }));
    expect(run.calls).toEqual([["claude", "-p", "/usage", "--no-session-persistence"]]);
    expect(usage.at).toBe(AT.toISOString());
    expect(usage.windows).toEqual([
      { name: "Current session", usedPercent: 24, resets: "Oct 2 at 11:20pm (Europe/Oslo)" },
      { name: "Current week (all models)", usedPercent: 33, resets: "Oct 8 at 6am (Europe/Oslo)" },
      { name: "Current week (Fable)", usedPercent: 0, resets: "Oct 8 at 6am (Europe/Oslo)" },
    ]);
    expect(usage.error).toBeUndefined();
  });

  test("a line counts as a window only when it starts with its label and share (AC-2)", () => {
    expect(parseClaudeUsage("  67% of your usage came from subagents\nTop skills: /aide-analyze 39%\n")).toEqual([]);
  });

  for (const code of [0, 1]) {
    test(`text with no window line is kept as printed, colour removed, exit ${code} (AC-4)`, async () => {
      const run = fakeRun({ code, stdout: `${ESC}[31mNot logged in · Please run /login${ESC}[0m\n` });
      const usage = await readUsage("claude", opts({ run }));
      expect(usage.windows).toEqual([]);
      expect(usage.text).toBe("Not logged in · Please run /login");
      expect(usage.error).toBeUndefined();
    });
  }

  test("a run that printed nothing is a reading that failed, not none (AC-5)", async () => {
    const usage = await readUsage("claude", opts({ run: fakeRun({ code: 1 }) }));
    expect(usage.error).toBeTruthy();
    expect(usage.windows).toEqual([]);
  });

  test("a run that timed out is a reading that failed (AC-5)", async () => {
    const usage = await readUsage("claude", opts({ run: fakeRun({ timedOut: true, stdout: "Current session: 2" }) }));
    expect(usage.error).toBeTruthy();
  });

  test("a CLI that cannot be started is a reading that failed, not a throw (AC-5)", async () => {
    const run = (async () => { throw new Error("ENOENT: claude"); }) as never;
    const usage = await readUsage("claude", opts({ run }));
    expect(usage.error).toContain("ENOENT");
  });
});

describe("Codex's usage", () => {
  test("is asked of codex app-server with initialize, initialized and account/rateLimits/read (AC-3)", async () => {
    const exchange = fakeExchange({ answer: CODEX_ANSWER });
    const usage = await readUsage("codex", opts({ exchange }));
    expect(exchange.sent).toHaveLength(1);
    expect(exchange.sent[0]!.argv).toEqual(["codex", "app-server"]);
    expect(exchange.sent[0]!.messages.map((m) => m.method)).toEqual([
      "initialize", "initialized", "account/rateLimits/read",
    ]);
    expect(usage.windows).toEqual([
      { name: "five_hour", usedPercent: 51, resetsAt: new Date(1790978086 * 1000).toISOString() },
      { name: "seven_day", usedPercent: 8, resetsAt: new Date(1791051017 * 1000).toISOString() },
    ]);
    expect(usage.error).toBeUndefined();
  });

  test("an answer with neither window reports none (AC-5)", async () => {
    const answer = { id: 2, result: { rateLimits: { primary: null, secondary: null } } };
    const usage = await readUsage("codex", opts({ exchange: fakeExchange({ answer }) }));
    expect(usage.windows).toEqual([]);
    expect(usage.error).toBeUndefined();
    expect(usage.noSource).toBeUndefined();
  });

  test("an exchange that timed out is a reading that failed (AC-5)", async () => {
    const usage = await readUsage("codex", opts({ exchange: fakeExchange({ timedOut: true }) }));
    expect(usage.error).toBeTruthy();
  });

  test("a JSON-RPC error is a reading that failed (AC-5)", async () => {
    const answer = { id: 2, error: { code: -32601, message: "method not found" } };
    const usage = await readUsage("codex", opts({ exchange: fakeExchange({ answer }) }));
    expect(usage.error).toContain("method not found");
  });

  // The same decision `codex_provider_limit` makes in bash, read from its
  // own text, so the two cannot drift apart unnoticed.
  test("a window is named from its length as provider-limit.sh names it (AC-3)", async () => {
    const bash = await Bun.file(
      new URL("../../../../core/scripts/lib/run-spec/turn/provider-limit.sh", import.meta.url),
    ).text();
    const def = /def name\(\$m\):(.*?)end;/.exec(bash)?.[1] ?? "";
    const named = new Map([...def.matchAll(/\$m == (\d+) then "(\w+)"/g)].map((m) => [Number(m[1]), m[2]!]));
    const otherwise = /else "(.*?)"/.exec(def)?.[1] ?? "";
    expect(named.size).toBe(2);
    expect(otherwise).toContain("\\($m)");
    for (const minutes of [300, 10080, 60]) {
      const bashName = named.get(minutes) ?? otherwise.replace("\\($m)", String(minutes));
      expect(codexWindowName(minutes)).toBe(bashName);
    }
  });
});

describe("the AIs with no usage to read", () => {
  test("OpenCode reports no windows and runs nothing (AC-5)", async () => {
    const run = fakeRun();
    const exchange = fakeExchange({ timedOut: true });
    const usage = await readUsage("opencode", opts({ run, exchange }));
    expect(run.calls).toEqual([]);
    expect(exchange.sent).toEqual([]);
    expect(usage.windows).toEqual([]);
    expect(usage.noSource).toBeUndefined();
    expect(usage.error).toBeUndefined();
  });

  test("Copilot's usage is not read, which is not the same as none (AC-5)", async () => {
    const run = fakeRun();
    const exchange = fakeExchange({ timedOut: true });
    const usage = await readUsage("copilot", opts({ run, exchange }));
    expect(run.calls).toEqual([]);
    expect(exchange.sent).toEqual([]);
    expect(usage.noSource).toBe(true);
  });
});

describe("the last usage per AI", () => {
  test("a check recorded afterwards, as before a job, leaves the reading in place (AC-1)", () => {
    forgetChecks();
    const reading = { tool: "claude" as const, at: AT.toISOString(), windows: [{ name: "Current session", usedPercent: 24 }] };
    recordUsage(reading);
    recordCheck({ tool: "claude", at: AT.toISOString(), found: true, lines: [], extra: [] });
    expect(lastUsage().claude).toEqual(reading);
    forgetChecks();
    expect(lastUsage().claude).toBeUndefined();
  });
});

describe("the checks the board runs on its own", () => {
  // `checkTool()` is what the start-up check and the re-check before a
  // job run. Usage is read by a press alone, so it must ask none.
  test("read no usage for any AI (AC-6)", async () => {
    for (const tool of CHECKABLE_TOOLS) {
      const run = fakeRun({ stdout: "found\n" });
      await checkTool(tool, { ...opts(), run, configuredModels: ["m"] });
      const ran = run.calls.map((argv) => argv.join(" "));
      expect(ran.length).toBeGreaterThan(0);
      expect(ran.filter((line) => line.includes("/usage") || line.includes("app-server"))).toEqual([]);
    }
  });
});
