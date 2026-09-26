// `logAndFinalMessage`: a step's log lines and its final message, with the
// last line left out when it only repeats the message. The rule is proven
// here, on the three transcript schemas, and nowhere else.

import { describe, expect, test } from "bun:test";
import { logAndFinalMessage } from "../../../src/queue/parse-stream";

const line = (o: unknown) => JSON.stringify(o);

const claude = (entries: unknown[], result: string): string =>
  [
    ...entries.map((e) => line({ type: "assistant", message: { content: [e] } })),
    line({ type: "result", subtype: "success", result }),
  ].join("\n");
const say = (text: string) => ({ type: "text", text });
const bash = (command: string) => ({ type: "tool_use", id: "t1", name: "Bash", input: { command } });

const codex = (items: unknown[]): string =>
  items.map((item) => line({ type: "item.completed", item })).join("\n");
const opencode = (parts: unknown[]): string =>
  parts.map((part) => line({ type: "text", part })).join("\n");

describe("logAndFinalMessage: a last entry that repeats the final message", () => {
  test("Claude: the repeat is left out and the message is returned once, whole (AC-3)", () => {
    const shown = logAndFinalMessage(claude([bash("bun test"), say("All done.")], "All done."));
    expect(shown.lines).toEqual(["Bash bun test"]);
    expect(shown.finalMessage).toBe("All done.");
  });

  test("Codex: the repeat is left out and the message is returned once, whole (AC-3)", () => {
    const shown = logAndFinalMessage(
      codex([
        { type: "command_execution", command: "bun test", exit_code: 0 },
        { type: "agent_message", text: "All done." },
      ]),
    );
    expect(shown.lines).toEqual(["bun test"]);
    expect(shown.finalMessage).toBe("All done.");
  });

  test("opencode: the repeat is left out and the message is returned once, whole (AC-3)", () => {
    const shown = logAndFinalMessage(
      opencode([{ type: "tool", tool: "read" }, { type: "text", text: "All done." }]),
    );
    expect(shown.lines).toEqual(["tool read"]);
    expect(shown.finalMessage).toBe("All done.");
  });

  test("escaped characters and a line break do not hide the repeat (AC-3)", () => {
    const message = 'Fixed <b> & "c"\nsecond line';
    const shown = logAndFinalMessage(claude([bash("x"), say(message)], message));
    expect(shown.lines).toEqual(["Bash x"]);
    expect(shown.finalMessage).toBe('Fixed &lt;b&gt; &amp; &quot;c&quot;\nsecond line');
  });

  test("a message longer than the log's cut is still recognised, and returned whole (AC-3)", () => {
    const message = `${"word ".repeat(80)}end & <done>`;
    const shown = logAndFinalMessage(claude([bash("x"), say(message)], message));
    expect(shown.lines).toEqual(["Bash x"]);
    expect(shown.finalMessage!.length).toBeGreaterThan(300);
    expect(shown.finalMessage!.endsWith("end &amp; &lt;done&gt;")).toBe(true);
  });

  test("a transcript whose only entry is the message has no lines and the message (AC-3)", () => {
    const shown = logAndFinalMessage(claude([say("Only this.")], "Only this."));
    expect(shown.lines).toEqual([]);
    expect(shown.finalMessage).toBe("Only this.");
  });
});

describe("logAndFinalMessage: a last entry that is not a repeat", () => {
  test("a last entry that is a tool call stays among the lines (AC-3)", () => {
    const shown = logAndFinalMessage(claude([say("All done."), bash("bun test")], "All done."));
    expect(shown.lines).toEqual(["All done.", "Bash bun test"]);
    expect(shown.finalMessage).toBe("All done.");
  });

  test("a last text that differs from the message stays among the lines (AC-3)", () => {
    const shown = logAndFinalMessage(claude([bash("x"), say("Almost.")], "All done."));
    expect(shown.lines).toEqual(["Bash x", "Almost."]);
    expect(shown.finalMessage).toBe("All done.");
  });

  test("a transcript with no final message returns the lines and no message (AC-3)", () => {
    const shown = logAndFinalMessage(
      [line({ type: "assistant", message: { content: [bash("bun test")] } })].join("\n"),
    );
    expect(shown.lines).toEqual(["Bash bun test"]);
    expect(shown.finalMessage).toBeUndefined();
  });
});
