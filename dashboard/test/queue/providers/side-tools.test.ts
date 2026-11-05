import { describe, expect, test } from "bun:test";
import {
  allowedSideChoices,
  resolveSidePick,
  sideToolRefusal,
  sideTools,
} from "../../../src/queue/providers/side-tools.ts";

const choices = {
  Sonnet: { tool: "claude" as const },
  Codex: { tool: "codex" as const },
  Pickle: { tool: "opencode" as const },
};

describe("review and verification choices", () => {
  test("uses a per-spec pick before the global pick and otherwise inherits it (AC-5, AC-6, AC-10, AC-11)", () => {
    expect(resolveSidePick("review", { review: "Codex" }, { review: "Sonnet" })).toBe("Codex");
    expect(resolveSidePick("review", undefined, { review: "Sonnet" })).toBe("Sonnet");
    expect(resolveSidePick("review", { review: "" }, { review: "Sonnet" })).toBe("Sonnet");
    expect(resolveSidePick("review", undefined, {})).toBeUndefined();
    expect(resolveSidePick("verify", undefined, {})).toBeUndefined();
  });

  test("offers only the implement tool and Codex (AC-12)", () => {
    expect(sideTools("claude")).toEqual(["claude", "codex"]);
    expect(sideTools("codex")).toEqual(["codex"]);
    expect(Object.keys(allowedSideChoices(choices, "claude"))).toEqual(["Sonnet", "Codex"]);
  });

  test("explains an unsupported choice (AC-13)", () => {
    expect(sideToolRefusal("review", "opencode", "claude")).toBe(
      "the review is set to run on opencode, which cannot run beside an implement on claude — pick claude or codex",
    );
  });
});
