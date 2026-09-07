// The compact picker's box (a narrow screen only): one line of text
// saying what the phase line is ON. The two selects inside the panel
// are the truth, and a pick that left the box stale would have the
// reader looking at "Claude/sonnet" over a Codex model until the page
// was drawn again.

import { describe, expect, test } from "bun:test";
import { refreshAiModelBox } from "../../src/queue-client/ai-sync.ts";

/** The picker as the browser sees it: a box, a model select, and an AI
 *  select whose option carries the word the box is to show. */
function picker(o: { model: string; tool: string; short?: string; ai?: boolean }) {
  const box = { textContent: "", title: "", setAttribute(_n: string, v: string) { this.title = v; } };
  const model = { value: o.model, selectedOptions: [{ dataset: { tool: o.tool } }] };
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
  test("says the AI's short word and the model, as the selects stand", () => {
    const { box, container } = picker({ model: "codex-luna", tool: "codex", short: "Codex" });
    refreshAiModelBox(container);
    expect(box.textContent).toBe("Codex/codex-luna");
  });

  // The word comes off the option the SERVER wrote it on: which word
  // stands for which tool is a fact about the page.
  test("falls back to the model's own tool when the AI select says nothing", () => {
    const { box, container } = picker({ model: "opus", tool: "claude", ai: false });
    refreshAiModelBox(container);
    expect(box.textContent).toBe("claude/opus");
  });

  // The box is 8rem wide and clips: the whole text is in the title, so
  // a long pair is still readable.
  test("the whole text is on the title too", () => {
    const { box, container } = picker({ model: "sonnet", tool: "claude", short: "Claude" });
    refreshAiModelBox(container);
    expect(box.title).toBe("Claude/sonnet");
  });

  test("a container with no box at all is left alone", () => {
    const container = { querySelector: () => null } as unknown as Element;
    expect(() => refreshAiModelBox(container)).not.toThrow();
  });
});
