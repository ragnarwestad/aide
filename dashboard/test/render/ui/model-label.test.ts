// What a picker calls a model choice: the version it gives, for an alias
// that has been read and for a choice named by its own Claude id alike.

import { describe, expect, test } from "bun:test";
import { aliasLabel } from "../../../src/render/ui/components/model-label.ts";

describe("aliasLabel", () => {
  test("a choice keyed by its own Claude id reads as that id's name, read or not (AC-4)", () => {
    expect(aliasLabel("claude-opus-4-8", undefined)).toBe("Opus 4.8");
    expect(aliasLabel("claude-opus-4-8", "claude-opus-4-8")).toBe("Opus 4.8");
  });

  test("an alias reads as the version recorded for it (AC-6)", () => {
    expect(aliasLabel("Fable", "claude-fable-5-1")).toBe("Fable 5.1");
  });

  test("an alias with nothing recorded and no id shape reads as itself", () => {
    expect(aliasLabel("Opus", undefined)).toBe("Opus");
    expect(aliasLabel("opusplan", undefined)).toBe("opusplan");
  });

  test("the name Claude Code gave wins while its id is the one the choice gives (AC-4, AC-6)", () => {
    const sonnet35 = { id: "claude-3-5-sonnet-20241022", name: "Sonnet 3.5" };
    expect(aliasLabel("claude-3-5-sonnet-20241022", undefined, sonnet35)).toBe("Sonnet 3.5");
    const wide = { id: "claude-opus-5-5[1m]", name: "Opus 5.5 (1M context)" };
    expect(aliasLabel("opus[1m]", "claude-opus-5-5[1m]", wide)).toBe("Opus 5.5 (1M context)");
    expect(aliasLabel("Opus", "claude-opus-5-6", { id: "claude-opus-5-5", name: "Opus 5.5" })).toBe("Opus 5.6");
  });
});
