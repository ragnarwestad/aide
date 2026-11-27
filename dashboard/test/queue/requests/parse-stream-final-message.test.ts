// `linesWithFinalMessage`: a step's log lines, the last of them the whole
// final message. A last line that only repeats the message is replaced by
// it; otherwise the message is appended. The rule is proven here, and
// nowhere else; it does not depend on the transcript schema.

import { describe, expect, test } from "bun:test";
import { linesWithFinalMessage } from "../../../src/queue/parse-stream";

const line = (o: unknown) => JSON.stringify(o);

const claude = (entries: unknown[], result: string): string =>
  [
    ...entries.map((e) => line({ type: "assistant", message: { content: [e] } })),
    line({ type: "result", subtype: "success", result }),
  ].join("\n");
const say = (text: string) => ({ type: "text", text });
const bash = (command: string) => ({ type: "tool_use", id: "t1", name: "Bash", input: { command } });

describe("linesWithFinalMessage: a last entry that repeats the final message", () => {
  test("Claude: the whole message is the last line and appears once", () => {
    expect(linesWithFinalMessage(claude([bash("bun test"), say("All done.")], "All done."))).toEqual([
      "Bash bun test",
      "All done.",
    ]);
  });

  test("escaped characters and a line break do not hide the repeat", () => {
    const message = 'Fixed <b> & "c"\nsecond line';
    expect(linesWithFinalMessage(claude([bash("x"), say(message)], message))).toEqual([
      "Bash x",
      'Fixed &lt;b&gt; &amp; &quot;c&quot;\nsecond line',
    ]);
  });

  test("a message longer than the log's cut is recognised, and the last line is whole", () => {
    const message = `${"word ".repeat(80)}end & <done>`;
    const lines = linesWithFinalMessage(claude([bash("x"), say(message)], message));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.length).toBeGreaterThan(300);
    expect(lines[1]!.endsWith("end &amp; &lt;done&gt;")).toBe(true);
  });

  test("a transcript whose only entry is the message is that one line", () => {
    expect(linesWithFinalMessage(claude([say("Only this.")], "Only this."))).toEqual(["Only this."]);
  });
});

describe("linesWithFinalMessage: a last entry that is not a repeat", () => {
  test("a last entry that is a tool call stays, and the message is appended", () => {
    expect(linesWithFinalMessage(claude([say("All done."), bash("bun test")], "All done."))).toEqual([
      "All done.",
      "Bash bun test",
      "All done.",
    ]);
  });

  test("a last text that differs from the message stays, and the message is appended", () => {
    expect(linesWithFinalMessage(claude([bash("x"), say("Almost.")], "All done."))).toEqual([
      "Bash x",
      "Almost.",
      "All done.",
    ]);
  });

  test("a transcript with no final message is its lines alone", () => {
    const text = [line({ type: "assistant", message: { content: [bash("bun test")] } })].join("\n");
    expect(linesWithFinalMessage(text)).toEqual(["Bash bun test"]);
  });
});
