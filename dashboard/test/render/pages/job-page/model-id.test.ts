// The model id a Claude run reported, beside the choice it ran on: the
// Overview's Model fact, and the step Log's separator through `aiModel`.

import { describe, expect, test } from "bun:test";
import { renderJobDetailPage } from "../../../../src/render";
import { withModelId } from "../../../../src/render/ui/components/model-label.ts";
import { detail, NAV } from "../fixtures.ts";

const draw = (over: Parameters<typeof detail>[0]) =>
  renderJobDetailPage(detail(over), "2026-09-17T00:00:00Z", NAV, { tab: "overview" });

describe("withModelId", () => {
  test("puts the id after the choice", () => {
    expect(withModelId("Opus", "claude-opus-5-5")).toBe("Opus · claude-opus-5-5");
  });

  test("no id shows the choice alone; no choice shows the id", () => {
    expect(withModelId("Opus", undefined)).toBe("Opus");
    expect(withModelId("Opus", "")).toBe("Opus");
    expect(withModelId(undefined, "claude-opus-5-5")).toBe("claude-opus-5-5");
  });
});

describe("the job page's Model fact", () => {
  test("names the id beside the choice (AC-2)", () => {
    expect(draw({ model: "Opus", modelId: "claude-opus-5-5" })).toContain("Opus · claude-opus-5-5");
  });

  test("a step with no stored id shows the choice alone (AC-2)", () => {
    const html = draw({ model: "Opus" });
    expect(html).toContain("Opus");
    expect(html).not.toContain(" · claude");
  });

  test("a Codex choice shows as it is, with no second id (AC-3)", () => {
    const html = draw({ model: "zen-free" });
    expect(html).toContain("zen-free");
    expect(html).not.toContain("zen-free ·");
  });
});
