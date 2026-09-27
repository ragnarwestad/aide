// The model id a Claude run reported, beside the choice it ran on: the
// Overview's Model fact, and the step Log's separator through `aiModel`.

import { describe, expect, test } from "bun:test";
import { renderJobDetailPage } from "../../../../src/render";
import { withModelId } from "../../../../src/render/ui/components/model-label.ts";
import { detail, NAV } from "../fixtures.ts";

const draw = (over: Parameters<typeof detail>[0]) =>
  renderJobDetailPage(detail(over), "2026-09-17T00:00:00Z", NAV, { tab: "overview" });

describe("withModelId", () => {
  test("reads a Claude id as its name, in the family word's place", () => {
    expect(withModelId("Opus", "claude-opus-5-5")).toBe("Opus 5.5");
    expect(withModelId("Claude Sonnet", "claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(withModelId("opus", "claude-opus-5-5")).toBe("Opus 5.5");
    expect(withModelId("Haiku", "claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  test("an id of another shape follows the choice", () => {
    expect(withModelId("Opus", "opus-next")).toBe("Opus · opus-next");
  });

  test("no id shows the choice alone; no choice shows the id", () => {
    expect(withModelId("Opus", undefined)).toBe("Opus");
    expect(withModelId("Opus", "")).toBe("Opus");
    expect(withModelId(undefined, "claude-opus-5-5")).toBe("Opus 5.5");
  });
});

describe("the job page's Model fact", () => {
  test("names the model the run reported (AC-2)", () => {
    expect(draw({ model: "Opus", modelId: "claude-opus-5-5" })).toContain("Opus 5.5");
  });

  test("a step with no stored id shows the choice alone (AC-2)", () => {
    const html = draw({ model: "Opus" });
    expect(html).toContain("Opus");
    expect(html).not.toContain("Opus 5");
  });

  test("a Codex choice shows as it is, with no second id (AC-3)", () => {
    const html = draw({ model: "zen-free" });
    expect(html).toContain("zen-free");
    expect(html).not.toContain("zen-free ·");
  });
});
