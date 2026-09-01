// Spec 318: SETTING_LABELS is the one place a setting's plain-language
// name is written down. The completeness check below is what makes
// REQ-4 ("exactly one place") mean something — a key added to
// SETTING_KEYS with no matching label would otherwise fall back to the
// raw key silently on the Config tab and throw on a Deploy-tab call
// site that reads the property directly.
import { describe, expect, test } from "bun:test";
import { SETTING_KEYS } from "../../src/project/project-settings.ts";
import { SETTING_LABELS } from "../../src/project/setting-labels.ts";

describe("SETTING_LABELS (spec 318)", () => {
  test("has exactly one label per SETTING_KEYS entry, and no others", () => {
    expect(Object.keys(SETTING_LABELS).sort()).toEqual([...SETTING_KEYS].sort());
  });
});
