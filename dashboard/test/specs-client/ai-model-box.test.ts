// The compact picker's box (a narrow screen only): two spans saying what
// the phase line is ON, a short one and an always tool-prefixed full one
// (spec 488) — the two selects inside the panel are the truth, and a
// pick that left either stale would have the reader looking at
// "Claude/sonnet" over a Codex model until the page was drawn again.

import { describe, expect, test } from "bun:test";
import { refreshAiModelBox } from "../../src/specs-client/ai-sync.ts";

/** The picker as the browser sees it: the two candidate spans, the box
 *  they sit inside (only ever written to for its `title`), a model
 *  select, and an AI select whose option carries the word the spans are
 *  to show. `options` is every `<option data-tool>` the model select
 *  carries (spec 480) — defaulting to one entry matching `model`/`tool`,
 *  i.e. no collision — so a case that wants two configured entries
 *  sharing one name can hand-build the list directly. */
function picker(o: {
  model: string;
  tool: string;
  short?: string;
  ai?: boolean;
  options?: { value: string; tool: string }[];
}) {
  const shortEl = { textContent: "" };
  const fullEl = { textContent: "" };
  const box = { title: "", setAttribute(_n: string, v: string) { this.title = v; } };
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
    shortEl,
    fullEl,
    box,
    container: {
      querySelector: (sel: string): unknown => {
        if (sel.includes("aimodelshort")) return shortEl;
        if (sel.includes("aimodelfull")) return fullEl;
        if (sel.includes("aimodelnow")) return box;
        if (sel.includes("data-ai")) return o.ai === false ? null : ai;
        return model;
      },
    } as unknown as Element,
  };
}

describe("the compact picker's box", () => {
  test("the bare model name, by default (AC-1, spec 480)", () => {
    const { shortEl, container } = picker({ model: "codex-luna", tool: "codex", short: "Codex" });
    refreshAiModelBox(container);
    expect(shortEl.textContent).toBe("codex-luna");
  });

  test("still the bare model name when the AI select says nothing", () => {
    const { shortEl, container } = picker({ model: "opus", tool: "claude", ai: false });
    refreshAiModelBox(container);
    expect(shortEl.textContent).toBe("opus");
  });

  // AC-1/AC-2, spec 488: the full span is always tool-prefixed, whether
  // or not two configured entries collide — unlike the short one beside
  // it, which prefixes only on a collision.
  test("the full span always names the tool ahead of the model (spec 488)", () => {
    const { fullEl, container } = picker({ model: "sonnet", tool: "claude", short: "Claude" });
    refreshAiModelBox(container);
    expect(fullEl.textContent).toBe("Claude · sonnet");
  });

  // The box itself is 8rem wide and clips whichever span is showing: the
  // whole (always tool-prefixed) text is in the title, so a long pair is
  // still readable on hover regardless of which span is visible.
  test("the whole (tool-prefixed) text is on the title too", () => {
    const { box, container } = picker({ model: "sonnet", tool: "claude", short: "Claude" });
    refreshAiModelBox(container);
    expect(box.title).toBe("Claude · sonnet");
  });

  // AC-2: the same tie-break the server's compactModelLabel() applies,
  // read off the model select's own option list — unreachable against
  // today's real config schema (2-analysis.md), so hand-built here too.
  test("names the tool first, when two configured entries share the model's name", () => {
    const { shortEl, container } = picker({
      model: "gpt-6",
      tool: "codex",
      short: "Codex",
      options: [
        { value: "gpt-6", tool: "claude" },
        { value: "gpt-6", tool: "codex" },
      ],
    });
    refreshAiModelBox(container);
    expect(shortEl.textContent).toBe("Codex · gpt-6");
  });

  test("a container with no spans at all is left alone", () => {
    const container = { querySelector: () => null } as unknown as Element;
    expect(() => refreshAiModelBox(container)).not.toThrow();
  });
});
