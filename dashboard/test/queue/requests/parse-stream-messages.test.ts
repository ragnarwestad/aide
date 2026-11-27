import { describe, expect, test } from "bun:test";
import { summarizeEntries } from "../../../src/queue/parse-stream";

// The messages filter: only what the model wrote, asked for
// before the bound.

const line = (o: unknown) => JSON.stringify(o);
const claudeText = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const claudeTool = (name: string, input: unknown) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] } });

const texts = (stream: string, tool?: "claude" | "codex" | "opencode") =>
  summarizeEntries(stream, { only: "messages", max: 10, tool }).map((e) => e.text);

describe("the messages filter", () => {
  test("Claude: the last ten text blocks, oldest first, nothing from a tool call", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 12; i++) {
      lines.push(claudeText(`message ${i}`));
      lines.push(claudeTool(i % 3 === 0 ? "Write" : i % 3 === 1 ? "Bash" : "Read", { file_path: "/x", command: "ls" }));
    }
    const out = texts(lines.join("\n"), "claude");
    expect(out).toEqual(Array.from({ length: 10 }, (_, i) => `message ${i + 3}`));
  });
});
