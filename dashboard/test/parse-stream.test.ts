// Criterion 11 (spec 02): a kept stream-json transcript becomes a
// bounded, escaped activity list. The input is arbitrary text a model
// wrote and arbitrary text a tool was handed, so two properties matter
// more than prettiness: the list can never grow without limit, and
// nothing in it can leave the page as markup.
import { describe, expect, test } from "bun:test";
import { summarizeStream } from "../src/parse-stream.ts";

const line = (o: unknown) => JSON.stringify(o);

const assistantText = (text: string) =>
  line({ type: "assistant", message: { content: [{ type: "text", text }] } });

const toolUse = (name: string, input: Record<string, unknown>) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

describe("summarizeStream", () => {
  test("keeps assistant text and tool calls, drops system and user noise", () => {
    const stream = [
      line({ type: "system", subtype: "init", cwd: "/x" }),
      assistantText("Reading queue.ts"),
      toolUse("Read", { file_path: "src/queue.ts" }),
      line({ type: "user", message: { content: [{ type: "tool_result", content: "…" }] } }),
      line({ type: "result", subtype: "success" }),
    ].join("\n");

    const activity = summarizeStream(stream, { max: 10 });

    expect(activity).toHaveLength(2);
    expect(activity[0]).toContain("Reading queue.ts");
    expect(activity[1]).toContain("Read");
    expect(activity[1]).toContain("src/queue.ts");
  });

  test("HTML-escapes tool input before it is ever rendered", () => {
    const stream = toolUse("Bash", { command: "<script>alert(1)</script>" });

    const activity = summarizeStream(stream, { max: 10 });

    expect(activity[0]).not.toContain("<script>");
    expect(activity[0]).toContain("&lt;script&gt;");
  });

  test("HTML-escapes assistant text too", () => {
    const activity = summarizeStream(assistantText('a <b> & "c"'), { max: 10 });

    expect(activity[0]).not.toContain("<b>");
    expect(activity[0]).toContain("&lt;b&gt;");
    expect(activity[0]).toContain("&amp;");
  });

  test("is bounded: only the last `max` events survive, because the tail is the answer", () => {
    const stream = Array.from({ length: 200 }, (_, i) => assistantText(`step ${i}`)).join("\n");

    const activity = summarizeStream(stream, { max: 12 });

    expect(activity).toHaveLength(12);
    expect(activity[11]).toContain("step 199");
    expect(activity.join(" ")).not.toContain("step 100");
  });

  test("a single entry is bounded too — a Write's input is a whole file", () => {
    const activity = summarizeStream(toolUse("Write", { content: "x".repeat(5000) }), { max: 5 });

    expect(activity[0]!.length).toBeLessThan(400);
  });

  test("a truncated or non-JSON line is skipped, not fatal", () => {
    const stream = [
      assistantText("before"),
      "not json at all",
      '{"type":"assistant","message":{"content":[{"type":"text","tex',
      assistantText("after"),
    ].join("\n");

    const activity = summarizeStream(stream, { max: 10 });

    expect(activity).toHaveLength(2);
    expect(activity[0]).toContain("before");
    expect(activity[1]).toContain("after");
  });

  test("an empty stream is an empty list, never a throw", () => {
    expect(summarizeStream("", { max: 10 })).toEqual([]);
    expect(summarizeStream("\n\n", { max: 10 })).toEqual([]);
  });

  test("thinking blocks stay out — they are not what the run is doing", () => {
    const stream = line({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "said" }] },
    });

    const activity = summarizeStream(stream, { max: 10 });

    expect(activity).toHaveLength(1);
    expect(activity[0]).toContain("said");
  });
});

// Spec 125: the second tool writes a different transcript. `codex exec
// --json` emits `thread.started` / `turn.*` / `item.*` events instead of
// claude's `assistant` messages, and the activity list is the same list
// either way — same shape, same bound, same escaping. The fixture PAIR
// below is what makes "equivalent" checkable rather than a word: one
// turn, one text response and one tool call, described in each tool's
// own schema.
const codexLine = (o: unknown) => JSON.stringify(o);

const codexAgentMessage = (text: string) =>
  codexLine({ type: "item.completed", item: { id: "i0", item_type: "agent_message", text } });

const codexCommand = (command: string) =>
  codexLine({
    type: "item.completed",
    item: { id: "i1", item_type: "command_execution", command, exit_code: 0, status: "completed" },
  });

describe("summarizeCodexStream", () => {
  test("a Codex turn and an equivalent Claude turn read the same", () => {
    const claude = [
      line({ type: "system", subtype: "init", cwd: "/x" }),
      assistantText("Reading queue.ts"),
      toolUse("Bash", { command: "cat src/queue.ts" }),
      line({ type: "result", subtype: "success" }),
    ].join("\n");
    const codex = [
      codexLine({ type: "thread.started", thread_id: "0199f4c2" }),
      codexLine({ type: "turn.started" }),
      codexAgentMessage("Reading queue.ts"),
      codexCommand("cat src/queue.ts"),
      codexLine({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }),
    ].join("\n");

    const fromClaude = summarizeStream(claude, { max: 10, tool: "claude" });
    const fromCodex = summarizeStream(codex, { max: 10, tool: "codex" });

    expect(fromCodex).toHaveLength(2);
    expect(fromCodex[0]).toBe(fromClaude[0]);
    // The tool's own label differs — Claude names the tool `Bash`, Codex
    // calls the same thing a command execution — but the subject, which
    // is what a reader is actually after, is the same line.
    expect(fromCodex[1]).toContain("cat src/queue.ts");
    expect(fromClaude[1]).toContain("cat src/queue.ts");
  });

  test("reasoning and thread chatter stay out, the same way thinking does", () => {
    const stream = [
      codexLine({ type: "thread.started", thread_id: "0199f4c2" }),
      codexLine({ type: "turn.started" }),
      codexLine({ type: "item.completed", item: { id: "i0", item_type: "reasoning", text: "hmm" } }),
      codexAgentMessage("said"),
      codexLine({ type: "turn.completed", usage: {} }),
    ].join("\n");

    const activity = summarizeStream(stream, { max: 10, tool: "codex" });

    expect(activity).toHaveLength(1);
    expect(activity[0]).toContain("said");
  });

  test("an item.started is not counted twice with its item.completed", () => {
    const stream = [
      codexLine({ type: "item.started", item: { id: "i0", item_type: "agent_message", text: "once" } }),
      codexAgentMessage("once"),
    ].join("\n");

    expect(summarizeStream(stream, { max: 10, tool: "codex" })).toHaveLength(1);
  });

  test("HTML-escapes a Codex command before it is ever rendered", () => {
    const stream = codexCommand("<script>alert(1)</script>");

    const activity = summarizeStream(stream, { max: 10, tool: "codex" });

    expect(activity[0]).not.toContain("<script>");
    expect(activity[0]).toContain("&lt;script&gt;");
  });

  test("bounded the same way: only the last `max` items survive", () => {
    const stream = Array.from({ length: 200 }, (_, i) => codexAgentMessage(`step ${i}`)).join("\n");

    const activity = summarizeStream(stream, { max: 12, tool: "codex" });

    expect(activity).toHaveLength(12);
    expect(activity[11]).toContain("step 199");
  });

  test("a file change names the files, not the word `file_change`", () => {
    const stream = codexLine({
      type: "item.completed",
      item: { id: "i2", item_type: "file_change", changes: [{ path: "src/queue.ts", kind: "update" }] },
    });

    const activity = summarizeStream(stream, { max: 10, tool: "codex" });

    expect(activity[0]).toContain("src/queue.ts");
  });

  test("a truncated or non-JSON line is skipped, not fatal", () => {
    const stream = [codexAgentMessage("before"), "not json", '{"type":"item.compl', codexAgentMessage("after")].join("\n");

    expect(summarizeStream(stream, { max: 10, tool: "codex" })).toHaveLength(2);
  });

  test("with no tool named, the schema is recognised from the stream itself", () => {
    // /live tails a transcript without always knowing which tool wrote
    // it — an old job has no `tool` recorded at all. Sniffing beats
    // showing an empty activity list.
    const codex = [
      codexLine({ type: "thread.started", thread_id: "0199f4c2" }),
      codexAgentMessage("sniffed"),
    ].join("\n");

    expect(summarizeStream(codex, { max: 10 })[0]).toContain("sniffed");
    expect(summarizeStream(assistantText("still claude"), { max: 10 })[0]).toContain("still claude");
  });
});
