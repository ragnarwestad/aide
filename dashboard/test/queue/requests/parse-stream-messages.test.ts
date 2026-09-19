import { describe, expect, test } from "bun:test";
import { resolveLogFilter, summarizeEntries } from "../../../src/queue/parse-stream";

// The messages filter (spec 500): only what the model wrote, asked for
// before the bound, in all three transcript schemas.

const line = (o: unknown) => JSON.stringify(o);
const claudeText = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const claudeTool = (name: string, input: unknown) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] } });
const codexMessage = (text: string) => line({ type: "item.completed", item: { id: "i0", item_type: "agent_message", text } });
const codexCommand = (command: string) =>
  line({ type: "item.completed", item: { id: "i1", item_type: "command_execution", command, exit_code: 0, status: "completed" } });
const codexFile = (path: string) =>
  line({ type: "item.completed", item: { id: "i2", item_type: "file_change", changes: [{ path, kind: "update" }] } });
const opencodeText = (text: string) => line({ type: "text", part: { type: "text", text } });
const opencodeTool = (tool: string) => line({ type: "tool_use", part: { type: "tool", tool } });

const texts = (stream: string, tool?: "claude" | "codex" | "opencode") =>
  summarizeEntries(stream, { only: "messages", max: 10, tool }).map((e) => e.text);

describe("the messages filter", () => {
  test("Claude: the last ten text blocks, oldest first, nothing from a tool call (AC-2)", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 12; i++) {
      lines.push(claudeText(`message ${i}`));
      lines.push(claudeTool(i % 3 === 0 ? "Write" : i % 3 === 1 ? "Bash" : "Read", { file_path: "/x", command: "ls" }));
    }
    const out = texts(lines.join("\n"), "claude");
    expect(out).toEqual(Array.from({ length: 10 }, (_, i) => `message ${i + 3}`));
  });

  test("Codex: agent_message items only (AC-2)", () => {
    const stream = [codexMessage("one"), codexCommand("ls"), codexFile("a.ts"), codexMessage("two")].join("\n");
    expect(texts(stream, "codex")).toEqual(["one", "two"]);
  });

  test("opencode: text parts only (AC-2)", () => {
    const stream = [opencodeText("one"), opencodeTool("bash"), opencodeText("two")].join("\n");
    expect(texts(stream, "opencode")).toEqual(["one", "two"]);
  });

  test("the filter is applied before the bound: ten messages survive forty commands after them (AC-2)", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 10; i++) lines.push(claudeText(`note ${i}`));
    for (let i = 0; i < 40; i++) lines.push(claudeTool("Bash", { command: `cmd ${i}` }));
    expect(texts(lines.join("\n"), "claude")).toHaveLength(10);
  });

  test("the Logs tab's ?only= still refuses it (AC-2)", () => {
    expect(resolveLogFilter("messages")).toBeUndefined();
  });
});
