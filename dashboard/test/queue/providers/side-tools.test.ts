import { describe, expect, test } from "bun:test";
import { resolveSidePick } from "../../../src/queue/providers/side-tools.ts";

describe("review and verification choices", () => {
  test("uses a per-spec pick before the global pick and is Off when neither exists (AC-3, AC-4)", () => {
    expect(resolveSidePick("review", { review: "Codex" }, { review: "Sonnet" })).toBe("Codex");
    expect(resolveSidePick("review", undefined, { review: "Sonnet" })).toBe("Sonnet");
    expect(resolveSidePick("review", { review: "" }, { review: "Sonnet" })).toBe("Sonnet");
    expect(resolveSidePick("review", undefined, {})).toBeUndefined();
    expect(resolveSidePick("verify", undefined, {})).toBeUndefined();
  });

});
