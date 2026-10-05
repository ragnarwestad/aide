// An opened step's tab is `?steptab=` in the address: one of Log, Changed
// files and Errors, and Log for anything else.

import { describe, expect, test } from "bun:test";
import { drawnParts, logPartLines, logPartWriter, resolveStepTab } from "../../../../src/render/pages/job-page/step-tabs.ts";
import type { LogPart, SubagentPart } from "../../../../src/queue/parse-stream";
import { S } from "../../../helpers/codex-fixtures.ts";

describe("resolveStepTab", () => {
  test("a named tab is kept, and no address or an unknown one is Log", () => {
    expect(resolveStepTab("files")).toBe("files");
    expect(resolveStepTab("errors")).toBe("errors");
    for (const steptab of [undefined, "", "everything", "commands", "nonsense"]) {
      expect(resolveStepTab(steptab)).toBe("log");
    }
  });
});

// A subagent's part as the Log draws it: the words are the catalogue's, the model's text arrives escaped once.
describe("a subagent's part as drawn", () => {
  const part: SubagentPart = {
    by: "subagent",
    name: "Feasibility review",
    asked: "Read &lt;the&gt; plan",
    lines: ["reading"],
    answer: "Two &lt;must&gt;-fix",
  };

  test("it is named by its task, and draws what it was asked, its lines and its answer (AC-3)", () => {
    expect(logPartWriter(part, undefined, "en")).toBe("Subagent: Feasibility review");
    expect(logPartLines(part, "en")).toEqual(["Asked: Read &lt;the&gt; plan", "reading", "Answered: Two &lt;must&gt;-fix"]);
  });

  test("with nothing asked it names its task, and with no answer it says so, escaping the name once (AC-3)", () => {
    const drawn = logPartLines({ ...part, name: "fea<sible", asked: undefined, answer: undefined }, "en");

    expect(drawn).toHaveLength(3);
    expect(drawn[0]).toContain("fea&lt;sible");
    expect(drawn[1]).toBe("reading");
    expect(drawn.join("\n")).not.toContain("Answered:");
  });

  test("an ordinary part draws its own lines, named as before (AC-5)", () => {
    const ai: LogPart = { by: "ai", lines: ["one"] };

    expect(logPartLines(ai, "en")).toEqual(["one"]);
    expect(logPartWriter(ai, "Codex", "en")).toBe("AI (Codex)");
  });

  test("a part whose work could not be read is drawn as the one sentence naming its thread and where Codex keeps it (AC-4)", () => {
    const drawn = drawnParts([{ by: "ai", lines: [] }, { by: "subagent", name: "feasibility", lines: [], unread: { thread: S } }], undefined, "en");

    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.writer).toBe("Subagent: feasibility");
    expect(drawn[0]!.lines).toHaveLength(1);
    expect(drawn[0]!.lines[0]).toContain(S);
    expect(drawn[0]!.lines[0]).toContain("CODEX_HOME");
    expect(drawn[0]!.lines[0]).toContain("~/.codex");
  });

  test("a part with no line to draw is left out, and one asked but with no lines yet is drawn (AC-4)", () => {
    const waiting: SubagentPart = { by: "subagent", name: "scope", asked: "Review it", lines: [] };

    expect(drawnParts([{ by: "ai", lines: [] }, { by: "aide", lines: [] }], undefined, "en")).toEqual([]);
    expect(drawnParts([waiting], undefined, "en").map((d) => d.writer)).toEqual(["Subagent: scope"]);
  });
});
