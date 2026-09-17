// Criterion 11 (spec 02): a kept stream-json transcript becomes a
// bounded, escaped activity list. The input is arbitrary text a model
// wrote and arbitrary text a tool was handed, so two properties matter
// more than prettiness: the list can never grow without limit, and
// nothing in it can leave the page as markup.
import { describe, expect, test } from "bun:test";
import {
  finalMessage,
  resolveLogFilter,
  summarizeCommands,
  summarizeEntries,
  summarizeStream,
} from "../../../src/queue/parse-stream";

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

  test("an item naming its kind as `type` reads the same as `item_type`", () => {
    // Measured against codex-cli 0.148.0 on 2026-08-20, from a real
    // `codex exec --json` turn: the completed item carries
    // `{"id":"item_0","type":"agent_message","text":"ok"}` — `type`,
    // not `item_type`. Spec 125 wrote the parser from the binary's
    // strings, where both names appear, and picked the one this
    // version does not send, so every Activity line came out empty.
    // Both are read, because the field name is the CLI's to change and
    // an old transcript still has to render.
    const asType = codexLine({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "ok" } });
    const asCommand = codexLine({
      type: "item.completed",
      item: { id: "item_1", type: "command_execution", command: "bun test" },
    });

    expect(summarizeStream(asType, { max: 10, tool: "codex" })[0]).toContain("ok");
    expect(summarizeStream(asCommand, { max: 10, tool: "codex" })[0]).toContain("bun test");
    expect(summarizeStream(codexAgentMessage("older"), { max: 10, tool: "codex" })[0]).toContain("older");
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

// Spec 452: the Logs tab's summary needs two things the bounded activity
// list above deliberately drops — which commands a step ran (with
// whatever outcome/duration its own tool's schema actually carries) and
// the assistant's own final message, in full. Neither tool's transcript
// alone carries BOTH a real exit code and a duration for every command
// (2-analysis.md's stream-format investigation), so the two fixtures
// below are deliberately NOT symmetric the way the activity-list pair
// above is.
const assistantToolUse = (id: string, name: string, input: Record<string, unknown>, timestamp: string) =>
  line({ type: "assistant", timestamp, message: { content: [{ type: "tool_use", id, name, input }] } });

const userToolResult = (toolUseId: string, isError: boolean, timestamp: string) =>
  line({ type: "user", timestamp, message: { content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: isError }] } });

describe("summarizeCommands", () => {
  test("a Claude Bash tool_use/tool_result pair yields one ok command with a computed duration", () => {
    const stream = [
      assistantToolUse("t1", "Bash", { command: "bun test" }, "2026-09-13T10:00:00.000Z"),
      userToolResult("t1", false, "2026-09-13T10:00:02.500Z"),
    ].join("\n");

    const commands = summarizeCommands(stream, { tool: "claude" });

    expect(commands).toHaveLength(1);
    expect(commands[0]!.command).toContain("bun test");
    expect(commands[0]!.outcome).toEqual({ kind: "ok" });
    expect(commands[0]!.durationMs).toBe(2500);
  });

  test("an is_error:true result yields a failed outcome — Claude never reports a numeric exit code", () => {
    const stream = [
      assistantToolUse("t1", "Bash", { command: "bun test" }, "2026-09-13T10:00:00.000Z"),
      userToolResult("t1", true, "2026-09-13T10:00:01.000Z"),
    ].join("\n");

    const commands = summarizeCommands(stream, { tool: "claude" });

    expect(commands[0]!.outcome).toEqual({ kind: "failed" });
  });

  test("a Codex command_execution item yields a real exit code and no duration — no event in that schema carries a timestamp", () => {
    const stream = codexLine({
      type: "item.completed",
      item: { id: "i1", item_type: "command_execution", command: "bun test", exit_code: 2, status: "completed" },
    });

    const commands = summarizeCommands(stream, { tool: "codex" });

    expect(commands).toHaveLength(1);
    expect(commands[0]!.command).toContain("bun test");
    expect(commands[0]!.outcome).toEqual({ kind: "exitCode", code: 2 });
    expect(commands[0]!.durationMs).toBeUndefined();
  });

  test("a non-Bash, non-command_execution tool call yields nothing", () => {
    const claudeStream = assistantToolUse("t1", "Read", { file_path: "src/queue.ts" }, "2026-09-13T10:00:00.000Z");
    const codexStream = codexLine({
      type: "item.completed",
      item: { id: "i1", item_type: "file_change", changes: [{ path: "src/queue.ts" }] },
    });

    expect(summarizeCommands(claudeStream, { tool: "claude" })).toEqual([]);
    expect(summarizeCommands(codexStream, { tool: "codex" })).toEqual([]);
  });
});

describe("finalMessage", () => {
  test("a Claude result event's result field comes back unclipped, past 160 characters", () => {
    const long = "x".repeat(200);
    const stream = line({ type: "result", subtype: "success", result: long });

    expect(finalMessage(stream, { tool: "claude" })).toBe(long);
  });

  test("a Codex stream's last agent_message wins over an earlier one", () => {
    const stream = [codexAgentMessage("first"), codexAgentMessage("last")].join("\n");

    expect(finalMessage(stream, { tool: "codex" })).toBe("last");
  });

  test("a stream with neither a result event nor an agent_message returns undefined", () => {
    expect(finalMessage(assistantText("just text"), { tool: "claude" })).toBeUndefined();
    expect(finalMessage(codexLine({ type: "turn.completed", usage: {} }), { tool: "codex" })).toBeUndefined();
  });
});

// The Logs tab's filter: a reader asking for one kind of line gets the
// last N OF THAT KIND, not the ones that happen to be in the last N
// lines. The three CLIs name a command, a write and a failure
// differently; this is where they become one word.
describe("summarizeEntries", () => {
  const toolUseId = (name: string, input: Record<string, unknown>, id: string) =>
    line({ type: "assistant", message: { content: [{ type: "tool_use", name, input, id }] } });
  const toolResult = (id: string, isError: boolean) =>
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError }] } });

  const CLAUDE = [
    assistantText("Looking at the queue"),
    toolUse("Read", { file_path: "src/queue.ts" }),
    toolUseId("Bash", { command: "bun test" }, "t1"),
    toolResult("t1", true),
    toolUse("Write", { file_path: "src/queue.ts" }),
    toolUse("Bash", { command: "git status" }),
  ].join("\n");

  test("a Claude transcript's lines carry what they are", () => {
    expect(summarizeEntries(CLAUDE).map((e) => [e.kind, e.failed ?? false])).toEqual([
      ["text", false],
      ["tool", false],
      ["command", true],
      ["file", false],
      ["command", false],
    ]);
  });

  test("only=commands keeps the commands, failed ones included", () => {
    expect(summarizeEntries(CLAUDE, { only: "commands" }).map((e) => e.text)).toEqual([
      "Bash bun test",
      "Bash git status",
    ]);
  });

  test("only=files keeps the writes, not the reads", () => {
    expect(summarizeEntries(CLAUDE, { only: "files" }).map((e) => e.text)).toEqual(["Write src/queue.ts"]);
  });

  test("only=errors keeps what the tool itself reported as a failure", () => {
    expect(summarizeEntries(CLAUDE, { only: "errors" }).map((e) => e.text)).toEqual(["Bash bun test"]);
  });

  test("the bound counts the kept kind, not every line before it", () => {
    const noise = Array.from({ length: 60 }, (_, i) => assistantText(`thinking ${i}`));
    const stream = [toolUse("Bash", { command: "bun test" }), ...noise].join("\n");

    expect(summarizeStream(stream)).not.toContain("Bash bun test");
    expect(summarizeEntries(stream, { only: "commands" }).map((e) => e.text)).toEqual(["Bash bun test"]);
  });

  test("a Codex transcript answers with the same words, and its own exit code", () => {
    const stream = [
      line({ type: "item.completed", item: { type: "command_execution", command: "bun test", exit_code: 1 } }),
      line({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/x.ts" }] } }),
      line({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
    ].join("\n");

    expect(summarizeEntries(stream).map((e) => [e.kind, e.failed ?? false])).toEqual([
      ["command", true],
      ["file", false],
      ["text", false],
    ]);
  });

  test("an opencode transcript does too", () => {
    const stream = [
      line({ type: "tool_use", part: { type: "tool", tool: "bash", state: { input: { command: "ls" }, metadata: { exit: 2 } } } }),
      line({ type: "tool_use", part: { type: "tool", tool: "write", state: { input: { filePath: "src/x.ts" } } } }),
      line({ type: "text", part: { type: "text", text: "done" } }),
    ].join("\n");

    expect(summarizeEntries(stream).map((e) => [e.kind, e.failed ?? false])).toEqual([
      ["command", true],
      ["file", false],
      ["text", false],
    ]);
  });

  test("an unknown filter in the URL shows the whole log rather than refusing", () => {
    expect(resolveLogFilter("everything")).toBeUndefined();
    expect(resolveLogFilter("commands")).toBe("commands");
  });
});
