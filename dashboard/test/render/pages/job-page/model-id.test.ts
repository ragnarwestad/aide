// The model id a Claude run reported, beside the choice it ran on: the
// Overview's Model fact, and the step Log's separator through `aiModel`.

import { describe, expect, test } from "bun:test";
import { withModelId } from "../../../../src/render/ui/components/model-label.ts";

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
