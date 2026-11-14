import { describe, expect, test } from "bun:test";
import { planReviewToSave, resolveSidePick } from "../../../src/queue/providers/side-tools.ts";

describe("review and verification choices", () => {
  test("uses a per-spec pick, then the part setting, then the default (AC-2, AC-4)", () => {
    const config = { default: "Opus", review: "Sonnet" };

    expect(resolveSidePick("review", { review: "Codex" }, config)).toBe("Codex");
    expect(resolveSidePick("review", undefined, config)).toBe("Sonnet");
    expect(resolveSidePick("review", { review: "" }, config)).toBe("Sonnet");
    expect(resolveSidePick("verify", undefined, config)).toBe("Opus");
  });
});

describe("Review under Analyze", () => {
  test("has no pick without its own choice, whatever the default and Implement's Review say (AC-6)", () => {
    const config = { default: "Opus", review: "Sonnet", verify: "Sonnet" };

    expect(resolveSidePick("plan-review", undefined, config)).toBeUndefined();
    expect(resolveSidePick("plan-review", { review: "Codex", "plan-review": "" }, config)).toBeUndefined();
    expect(resolveSidePick("plan-review", undefined, { ...config, "plan-review": "Sonnet" })).toBe("Sonnet");
    expect(resolveSidePick("plan-review", { "plan-review": "Codex" }, { ...config, "plan-review": "Sonnet" })).toBe("Codex");
  });

  test("a Settings save keeps a pair that only follows Analyze out of the config (AC-6)", () => {
    const analyze = { model: "Opus", provider: "Claude" };

    expect(planReviewToSave({ model: "Opus", provider: "Claude" }, analyze, { model: "Opus" }, false)).toBeNull();
    expect(planReviewToSave({ model: "Sonnet", provider: "Claude" }, analyze, { model: "Sonnet", provider: "Claude" }, false)).toBeNull();
    expect(planReviewToSave({ model: "Sonnet", provider: "Claude" }, analyze, { model: "Sonnet", provider: "Claude" }, true))
      .toEqual({ model: "Sonnet", provider: "Claude" });
    expect(planReviewToSave({ model: "Opus", provider: "Claude-B" }, analyze, { model: "Opus", provider: "Claude" }, false))
      .toEqual({ model: "Opus", provider: "Claude-B" });
    expect(planReviewToSave({ model: "gpt", provider: "Codex" }, analyze, { model: "Opus" }, false))
      .toEqual({ model: "gpt", provider: "Codex" });
  });
});
