import { describe, expect, test } from "bun:test";
import { LANGUAGES, t } from "../../../src/i18n";
import { stateIconName } from "../../../src/render/ui/components/state-icon.ts";

describe("stateIconName()", () => {
  // Waiting is a spec standing still until something else is done, not a
  // step under way: it takes no spinner, though its word ends in -ing.
  test("Waiting carries no spinner, in any language", () => {
    for (const lang of LANGUAGES) {
      expect({ lang, icon: stateIconName(t(lang, "list.state.waiting")) }).not.toEqual({ lang, icon: "loader" });
    }
    expect(stateIconName(t("en", "list.state.waiting"))).toBe("");
    expect(stateIconName(t("nb", "list.state.waiting"))).toBe("");
  });

  test("a step under way keeps its spinner", () => {
    expect(stateIconName("Running")).toBe("loader");
    expect(stateIconName("Analyzing")).toBe("loader");
  });
});
