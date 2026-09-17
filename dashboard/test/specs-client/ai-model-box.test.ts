// The compact picker's box (a narrow screen only): one line of text
// saying what the phase line is ON. The two selects inside the panel
// are the truth, and a pick that left the box stale would have the
// reader looking at "Claude/sonnet" over a Codex model until the page
// was drawn again.

import { describe, expect, test } from "bun:test";
import { refreshAiModelBox } from "../../src/specs-client/ai-sync.ts";

/** The picker as the browser sees it: a box, a model select, and an AI
 *  select whose option carries the word the box is to show. `options`
 *  is every `<option data-tool>` the model select carries (spec 480) —
 *  defaulting to one entry matching `model`/`tool`, i.e. no collision —
 *  so a case that wants two configured entries sharing one name can
 *  hand-build the list directly. */
function picker(o: {
  model: string;
  tool: string;
  short?: string;
  ai?: boolean;
  options?: { value: string; tool: string }[];
}) {
  const box = { textContent: "", title: "", setAttribute(_n: string, v: string) { this.title = v; } };
  const options = (o.options ?? [{ value: o.model, tool: o.tool }]).map((opt) => ({
    value: opt.value,
    dataset: { tool: opt.tool },
  }));
  const model = {
    value: o.model,
    selectedOptions: [{ dataset: { tool: o.tool } }],
    querySelectorAll: (sel: string) => (sel.includes("data-tool") ? options : []),
  };
  const ai = { selectedOptions: [{ dataset: { short: o.short } }] };
  return {
    box,
    container: {
      querySelector: (sel: string): unknown =>
        sel.includes("aimodelnow") ? box : sel.includes("data-ai") ? (o.ai === false ? null : ai) : model,
    } as unknown as Element,
  };
}

describe("the compact picker's box", () => {
  test("the bare model name, by default (AC-1, spec 480)", () => {
    const { box, container } = picker({ model: "codex-luna", tool: "codex", short: "Codex" });
    refreshAiModelBox(container);
    expect(box.textContent).toBe("codex-luna");
  });

  test("still the bare model name when the AI select says nothing", () => {
    const { box, container } = picker({ model: "opus", tool: "claude", ai: false });
    refreshAiModelBox(container);
    expect(box.textContent).toBe("opus");
  });

  // The box is 8rem wide and clips: the whole text is in the title, so
  // a long pair is still readable.
  test("the whole text is on the title too", () => {
    const { box, container } = picker({ model: "sonnet", tool: "claude", short: "Claude" });
    refreshAiModelBox(container);
    expect(box.title).toBe("sonnet");
  });

  // AC-2: the same tie-break the server's compactModelLabel() applies,
  // read off the model select's own option list — unreachable against
  // today's real config schema (2-analysis.md), so hand-built here too.
  test("names the tool first, when two configured entries share the model's name", () => {
    const { box, container } = picker({
      model: "gpt-6",
      tool: "codex",
      short: "Codex",
      options: [
        { value: "gpt-6", tool: "claude" },
        { value: "gpt-6", tool: "codex" },
      ],
    });
    refreshAiModelBox(container);
    expect(box.textContent).toBe("Codex · gpt-6");
  });

  test("a container with no box at all is left alone", () => {
    const container = { querySelector: () => null } as unknown as Element;
    expect(() => refreshAiModelBox(container)).not.toThrow();
  });
});
