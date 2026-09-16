// opencode's transcript: one JSON event per line, the interesting part
// under `part` rather than at the top level. Its events are the only
// ones shaped that way, which is what lets `summarizeStream` tell the
// three schemas apart with nobody saying which it is.
//
// The fixtures are the shape opencode 1.18.31 actually emits, taken
// from a real headless run on this host.

import { describe, expect, test } from "bun:test";
import {
  finalMessage,
  summarizeCommands,
  summarizeOpencodeStream,
  summarizeStream,
} from "../../../src/queue/parse-stream.ts";

const SESSION = "ses_f5706d229ffeybcta39ML4GY02";

const line = (o: unknown) => JSON.stringify(o);

const STREAM = [
  line({ type: "step_start", sessionID: SESSION, part: { type: "step-start" } }),
  line({ type: "tool_use", sessionID: SESSION, part: { type: "tool", tool: "glob" } }),
  line({ type: "tool_use", sessionID: SESSION, part: { type: "tool", tool: "read" } }),
  line({ type: "text", sessionID: SESSION, part: { type: "text", text: "The file says hello" } }),
  line({
    type: "step_finish",
    sessionID: SESSION,
    part: { type: "step-finish", reason: "stop", cost: 0.02, tokens: { input: 10, output: 2 } },
  }),
].join("\n");

describe("summarizeOpencodeStream", () => {
  test("a tool call and the assistant's words both reach the line, in order", () => {
    expect(summarizeOpencodeStream(STREAM)).toEqual([
      "tool glob",
      "tool read",
      "The file says hello",
    ]);
  });

  test("the run's own bookkeeping is left out", () => {
    // step-start and step-finish say nothing about what the run is
    // doing, and a reader watching a live step wants only the doing.
    const out = summarizeOpencodeStream(STREAM).join(" ");
    expect(out).not.toContain("step-start");
    expect(out).not.toContain("step-finish");
  });

  test("a half-written last line costs nothing", () => {
    const killed = `${STREAM}\n{"type":"text","part":{"ty`;
    expect(summarizeOpencodeStream(killed)).toEqual(summarizeOpencodeStream(STREAM));
  });

  test("the entries are escaped, so a transcript cannot write markup onto the page", () => {
    const nasty = line({
      type: "text",
      sessionID: SESSION,
      part: { type: "text", text: "<script>alert(1)</script>" },
    });
    expect(summarizeOpencodeStream(nasty).join("")).not.toContain("<script>");
  });
});

describe("summarizeStream telling the schemas apart", () => {
  test("an opencode transcript is recognised with nobody saying so", () => {
    expect(summarizeStream(STREAM)).toEqual(summarizeOpencodeStream(STREAM));
  });

  test("naming the tool wins over the sniff", () => {
    expect(summarizeStream(STREAM, { tool: "opencode" })).toEqual(
      summarizeOpencodeStream(STREAM),
    );
  });

  test("a claude transcript is still read as claude", () => {
    const claude = [
      line({ type: "system", subtype: "init", cwd: "/x" }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "Reading queue.ts" }] } }),
    ].join("\n");
    expect(summarizeStream(claude)).toEqual(["Reading queue.ts"]);
  });

  test("a codex transcript is still read as codex", () => {
    const codex = [
      line({ type: "thread.started", thread_id: "t1" }),
      line({ type: "item.completed", item: { item_type: "agent_message", text: "done" } }),
    ].join("\n");
    expect(summarizeStream(codex)).toEqual(["done"]);
  });
});

// The three readers a transcript has, not one: the progress line, the
// commands table and the run's closing word. Adding opencode to the
// first alone left the other two reading its transcript as Claude's and
// finding nothing — empty where it should have been full.

const CMD_STREAM = [
  line({
    type: "tool_use",
    sessionID: SESSION,
    part: {
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "echo hello-from-shell" },
        metadata: { output: "hello-from-shell\n", exit: 0 },
        time: { start: 1000, end: 1250 },
      },
    },
  }),
  line({
    type: "tool_use",
    sessionID: SESSION,
    part: {
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "false" },
        metadata: { exit: 1 },
        time: { start: 2000, end: 2010 },
      },
    },
  }),
  // A non-shell tool is not a command, and says nothing about one.
  line({ type: "tool_use", sessionID: SESSION, part: { type: "tool", tool: "read" } }),
  line({ type: "text", sessionID: SESSION, part: { type: "text", text: "half way" } }),
  line({ type: "text", sessionID: SESSION, part: { type: "text", text: "all done" } }),
].join("\n");

describe("summarizeCommands for opencode", () => {
  test("a shell command reaches the table with its exit code and its duration", () => {
    const commands = summarizeCommands(CMD_STREAM);
    expect(commands).toEqual([
      { command: "echo hello-from-shell", outcome: { kind: "exitCode", code: 0 }, durationMs: 250 },
      { command: "false", outcome: { kind: "exitCode", code: 1 }, durationMs: 10 },
    ]);
  });

  test("a tool that is not the shell is not reported as a command", () => {
    expect(summarizeCommands(CMD_STREAM).some((c) => c.command.includes("read"))).toBe(false);
  });

  test("an exit code that is not there is never invented", () => {
    const noExit = line({
      type: "tool_use",
      sessionID: SESSION,
      part: { type: "tool", tool: "bash", state: { input: { command: "still running" } } },
    });
    expect(summarizeCommands(noExit)).toEqual([]);
  });
});

describe("finalMessage for opencode", () => {
  test("the LAST thing the run said is its closing word", () => {
    expect(finalMessage(CMD_STREAM)).toBe("all done");
  });

  test("a transcript that said nothing has no closing word", () => {
    const quiet = line({ type: "step_start", sessionID: SESSION, part: { type: "step-start" } });
    expect(finalMessage(quiet)).toBeUndefined();
  });
});
