import { describe, expect, test } from "bun:test";
import { resolveSidePick } from "../../../src/queue/providers/side-tools.ts";

describe("review and verification choices", () => {
  test("uses a per-spec pick, then the part setting, then the default (AC-2, AC-4)", () => {
    const config = { default: "Opus", review: "Sonnet" };

    expect(resolveSidePick("review", { review: "Codex" }, config)).toBe(
      "Codex",
    );
    expect(resolveSidePick("review", undefined, config)).toBe("Sonnet");
    expect(resolveSidePick("review", { review: "" }, config)).toBe("Sonnet");
    expect(resolveSidePick("verify", undefined, config)).toBe("Opus");
  });
});
