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
  summarizeOpencodeStream,
  summarizeStream,
} from "../../../src/queue/parse-stream";

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
});

describe("summarizeStream telling the schemas apart", () => {
  test("an opencode transcript is recognised with nobody saying so", () => {
    expect(summarizeStream(STREAM)).toEqual(summarizeOpencodeStream(STREAM));
  });
});

// The two readers a transcript has, not one: the progress line and the
// run's closing word. Adding opencode to the first alone left the other
// reading its transcript as Claude's and finding nothing.

/** One completed opencode bash call, as its transcript line. */
const bashCall = (command: string, metadata: object, time: { start: number; end: number }) =>
  line({
    type: "tool_use",
    sessionID: SESSION,
    part: { type: "tool", tool: "bash", state: { status: "completed", input: { command }, metadata, time } },
  });

const CMD_STREAM = [
  bashCall("echo hello-from-shell", { output: "hello-from-shell\n", exit: 0 }, { start: 1000, end: 1250 }),
  bashCall("false", { exit: 1 }, { start: 2000, end: 2010 }),
  // A non-shell tool is not a command, and says nothing about one.
  line({ type: "tool_use", sessionID: SESSION, part: { type: "tool", tool: "read" } }),
  line({ type: "text", sessionID: SESSION, part: { type: "text", text: "half way" } }),
  line({ type: "text", sessionID: SESSION, part: { type: "text", text: "all done" } }),
].join("\n");

describe("finalMessage for opencode", () => {
  test("the LAST thing the run said is its closing word", () => {
    expect(finalMessage(CMD_STREAM)).toBe("all done");
  });

  test("a transcript that said nothing has no closing word", () => {
    const quiet = line({ type: "step_start", sessionID: SESSION, part: { type: "step-start" } });
    expect(finalMessage(quiet)).toBeUndefined();
  });
});
