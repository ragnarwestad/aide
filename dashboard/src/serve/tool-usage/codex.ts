// Codex's usage, asked of `codex app-server` over JSON-RPC:
// `account/rateLimits/read` answers from the account and runs no model.
// The server speaks one JSON object per line on stdin and stdout, and
// answers only while its stdin is open — closing it straight after
// writing ends the server with no answer at all (codex-cli 0.159.3,
// 2026-10-02) — so `runScript()`, which opens no stdin, cannot drive it.

import { spawnEnv } from "../tool-path.ts";
import { scriptArgv } from "../../integrations/script-argv.ts";
import { signalGroup } from "../serve-helpers/signal-group.ts";
import type { ToolUsage, UsageWindow } from "../../render";

/** A window's name from its length in minutes. The same rule as
 *  `name($m)` in `codex_provider_limit` (core/scripts/lib/run-spec/turn/
 *  provider-limit.sh), pinned by a test that reads both. */
export function codexWindowName(minutes: number): string {
  if (minutes === 300) return "five_hour";
  if (minutes === 10080) return "seven_day";
  return `${minutes}_minutes`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The windows in `result.rateLimits`: `primary` and `secondary`, each
 *  of which may be null. Both null is an account with no window. */
export function parseCodexRateLimits(result: unknown): UsageWindow[] {
  const limits = isObject(result) ? result.rateLimits : undefined;
  if (!isObject(limits)) return [];
  const windows: UsageWindow[] = [];
  for (const window of [limits.primary, limits.secondary]) {
    if (!isObject(window) || typeof window.usedPercent !== "number") continue;
    const minutes = typeof window.windowDurationMins === "number" ? window.windowDurationMins : 0;
    windows.push({
      name: codexWindowName(minutes),
      usedPercent: Math.round(window.usedPercent),
      ...(typeof window.resetsAt === "number" ? { resetsAt: new Date(window.resetsAt * 1000).toISOString() } : {}),
    });
  }
  return windows;
}

export type ExchangeReply = { answer: Record<string, unknown> } | { timedOut: true } | { error: string };

/** Writes `messages`, one per line, and answers with the line whose `id`
 *  is `id`. The server is started in a group of its own, and that group
 *  is ended once the answer is in, or the time is up. */
export type UsageExchange = (
  argv: string[],
  messages: object[],
  id: number,
  timeoutMs: number,
) => Promise<ExchangeReply>;

async function answerLine(stdout: ReadableStream<Uint8Array>, id: number): Promise<ExchangeReply> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of stdout) {
    buffered += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (!line.startsWith("{")) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        // Notifications (`configWarning`, `account/updated`, …) carry no
        // id of this request's, and are not the answer.
        if (isObject(parsed) && parsed.id === id) return { answer: parsed };
      } catch {
        // A line that is not JSON is not the answer either.
      }
    }
  }
  return { error: "codex app-server ended without answering." };
}

export const appServerExchange: UsageExchange = async (argv, messages, id, timeoutMs) => {
  const env = spawnEnv();
  const proc = Bun.spawn({
    cmd: scriptArgv(argv, env.PATH),
    cwd: process.cwd(),
    env,
    stdin: "pipe",
    stdout: "pipe",
    // Its log goes to stderr, and an unread pipe would fill.
    stderr: "ignore",
    detached: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ExchangeReply>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    for (const message of messages) proc.stdin.write(`${JSON.stringify(message)}\n`);
    await proc.stdin.flush();
    return await Promise.race([answerLine(proc.stdout, id), timeout]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    try {
      await proc.stdin.end();
    } catch {
      // Already closed: the server ended first.
    }
    // The server never ends by itself. TERM its group, and KILL whatever
    // is still there a few seconds on.
    signalGroup(proc.pid);
    const hard = setTimeout(() => signalGroup(proc.pid, "SIGKILL"), 3_000);
    await proc.exited;
    clearTimeout(hard);
  }
};

/** The three lines the exchange needs: the handshake, its notification,
 *  then the question itself, as request 2. */
export const RATE_LIMITS_REQUEST_ID = 2;
export const RATE_LIMITS_MESSAGES = [
  { id: 1, method: "initialize", params: { clientInfo: { name: "aide_dashboard", title: "Aide dashboard", version: "1.0.0" } } },
  { method: "initialized" },
  { id: RATE_LIMITS_REQUEST_ID, method: "account/rateLimits/read" },
];

/** The reading. A JSON-RPC error, or no answer in time, is a reading
 *  that failed — never one with no windows. */
export async function readCodexUsage(
  exchange: UsageExchange,
  bin: string,
  base: Pick<ToolUsage, "tool" | "at">,
  timeoutMs: number,
): Promise<ToolUsage> {
  const reply = await exchange([bin, "app-server"], RATE_LIMITS_MESSAGES, RATE_LIMITS_REQUEST_ID, timeoutMs);
  if ("timedOut" in reply) return { ...base, windows: [], error: "codex app-server did not answer in time." };
  if ("error" in reply) return { ...base, windows: [], error: reply.error };
  const { answer } = reply;
  if (isObject(answer.error)) {
    const message = typeof answer.error.message === "string" ? answer.error.message : JSON.stringify(answer.error);
    return { ...base, windows: [], error: `codex app-server refused account/rateLimits/read: ${message}` };
  }
  return { ...base, windows: parseCodexRateLimits(answer.result) };
}
