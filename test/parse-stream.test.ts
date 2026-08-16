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
