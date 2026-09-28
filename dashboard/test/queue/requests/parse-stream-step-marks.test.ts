// Skill-step marks in a transcript: the lines `step_log_note` asks the
// model to write, one per step start and end. Each is a line of its own
// in the Log, and no bound on the number of lines drops one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { linesWithFinalMessage, summarizeEntries, summarizeStream } from "../../../src/queue/parse-stream";

const line = (o: unknown) => JSON.stringify(o);
const say = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const bash = (command: string) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command } }] } });
const result = (text: string) => line({ type: "result", subtype: "success", result: text });

const START = "--- Step 1 of 9: Read the description — started";
const DONE = "--- Step 1 of 9: Read the description — done";

describe("a mark is a line of its own", () => {
  test("a text block with two marks and prose between them gives three lines, not one", () => {
    expect(summarizeStream(say(`${START}\n\nThe description asks for two tabs.\n\n${DONE}`), { tool: "claude" })).toEqual([
      START,
      "The description asks for two tabs.",
      DONE,
    ]);
  });

  test("a mark wrapped in backticks or bold is still a mark, shown bare", () => {
    expect(summarizeStream(say(`\`${START}\`\n**${DONE}**`), { tool: "claude" })).toEqual([START, DONE]);
  });

  test("a done with a note after it, and a skipped with its reason, are marks", () => {
    const text = "--- Step 4 of 9: Check for work already begun — done (nothing to keep)\n--- Step 5 of 9: Update — skipped: nothing to update";
    expect(summarizeEntries(say(text), { tool: "claude" }).every((e) => e.mark)).toBe(true);
  });

  test("a codex agent message is split the same way", () => {
    const item = line({ type: "item.completed", item: { type: "agent_message", text: `${START}\nReading.\n${DONE}` } });
    expect(summarizeStream(item, { tool: "codex" })).toEqual([START, "Reading.", DONE]);
  });

  test("a mark from a log written before the prefix is still a mark", () => {
    expect(summarizeEntries(say("analyze · Step 1 of 9: Read the description — done"), { tool: "claude" })[0]!.mark).toBe(true);
  });

  test("prose that only mentions a step is not a mark", () => {
    expect(summarizeEntries(say("Step 6 (Create the implementation plan) first."), { tool: "claude" })[0]!.mark).toBeUndefined();
  });
});

describe("no bound drops a mark", () => {
  test("forty later lines push out older lines but not the marks among them", () => {
    const text = [say(START), bash("early"), say(DONE), ...Array.from({ length: 40 }, (_, i) => bash(`later ${i}`))].join("\n");
    const lines = summarizeStream(text, { tool: "claude", max: 3 });
    expect(lines).toEqual([START, DONE, "Bash later 37", "Bash later 38", "Bash later 39"]);
  });
});

describe("a final message holding marks", () => {
  test("its marks and prose are not repeated after the lines they already made", () => {
    const message = `--- Step 9 of 9: Confirm — started\nAnalysis written.\n--- Step 9 of 9: Confirm — done`;
    expect(linesWithFinalMessage([bash("x"), say(message), result(message)].join("\n"), { tool: "claude" })).toEqual([
      "Bash x",
      "--- Step 9 of 9: Confirm — started",
      "Analysis written.",
      "--- Step 9 of 9: Confirm — done",
    ]);
  });
});

// The format is decided twice: the prompt in bash tells the model how to
// write a mark, and the parser here reads it. Every ending the prompt
// names must come back as a mark.
describe("the prompt's own format is what the parser reads", () => {
  test("each line step_log_note asks for is a mark", () => {
    const script = readFileSync(join(import.meta.dir, "../../../../core/scripts/lib/run-spec-invocation.sh"), "utf-8");
    const note = script.slice(script.indexOf('step_log_note="'), script.indexOf('"\n', script.indexOf('step_log_note="')));
    const template = note.split("\n").find((l) => l.startsWith("--- Step "))!;
    const endings = note.split("\n").filter((l) => l.startsWith("— ")).map((l) => l.replace(/ \(.*\)$/, "").replace("<why>", "no tests"));
    expect(template).toBeDefined();
    expect(endings.length).toBeGreaterThanOrEqual(3);
    const head = template.replace("Step N of X", "Step 2 of 4").replace("<title>", "GREEN").replace(/ — started$/, "");
    for (const ending of ["— started", ...endings]) {
      expect(summarizeEntries(say(`${head} ${ending}`), { tool: "claude" })[0]!.mark).toBe(true);
    }
  });
});
