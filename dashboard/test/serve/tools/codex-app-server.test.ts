// The JSON-RPC exchange with `codex app-server`, against a stand-in that
// behaves the way the real one does: it answers only while its stdin is
// open, prints notifications beside the answer, and never ends by itself.
// What matters is that the answer is the line carrying the request's own
// id, and that no stand-in is left running afterwards.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appServerExchange } from "../../../src/serve/tool-usage/codex.ts";

const dir = mkdtempSync(join(tmpdir(), "aide-app-server-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Written once for the file: a new executable costs macOS seconds the
// first time it is started. Like the real server, it answers a moment
// after the question, and ends at once, unanswered, when stdin closes.
const STAND_IN = join(dir, "app-server");
writeFileSync(
  STAND_IN,
  [
    "#!/bin/sh",
    'echo $$ > "$1"',
    'while IFS= read -r line; do',
    '  [ "$2" = silent ] && continue',
    '  case "$line" in',
    `    *'"id":1'*) printf '%s\\n' '{"id":1,"result":{}}' ;;`,
    `    *'"id":2'*) (sleep 0.2; printf '%s\\n' '{"method":"account/updated","params":{}}' '{"id":2,"result":{"ok":true}}') & ;;`,
    "  esac",
    "done",
    '[ -n "$!" ] && kill "$!" 2>/dev/null',
    "exit 0",
    "",
  ].join("\n"),
  { mode: 0o755 },
);

const MESSAGES = [
  { id: 1, method: "initialize", params: { clientInfo: { name: "test", version: "0" } } },
  { method: "initialized" },
  { id: 2, method: "account/rateLimits/read" },
];

const isGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

describe("the app-server exchange", () => {
  test("answers with the line carrying the request's id, and ends the server (AC-3)", async () => {
    const pidFile = join(dir, "answer.pid");
    const reply = await appServerExchange([STAND_IN, pidFile, "answer"], MESSAGES, 2, 10_000);
    expect(reply).toEqual({ answer: { id: 2, result: { ok: true } } });
    expect(isGone(Number(readFileSync(pidFile, "utf8").trim()))).toBe(true);
  });

  test("a server that never answers times out, and is ended (AC-3)", async () => {
    const pidFile = join(dir, "silent.pid");
    const reply = await appServerExchange([STAND_IN, pidFile, "silent"], MESSAGES, 2, 300);
    expect(reply).toEqual({ timedOut: true });
    expect(isGone(Number(readFileSync(pidFile, "utf8").trim()))).toBe(true);
  });
});
