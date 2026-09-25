// Every state badge carries its state's icon in front of the word
// (2026-09-25). The icon is picked from the badge's own word, in either
// language, since the word is the one thing every caller of `badge()`
// already hands over.

import { describe, expect, test } from "bun:test";
import { badge } from "../../../../src/render/ui/components";
import { stateIconName } from "../../../../src/render/ui/components/state-icon.ts";

describe("the icon a state's word takes", () => {
  test.each([
    ["done", "check"], ["ferdig", "check"],
    ["archived", "archive"], ["arkivert", "archive"],
    ["ready", "play"], ["queued", "clock"], ["i kø", "clock"],
    ["failed", "failed"], ["feilet", "failed"],
    ["stopped", "stopped"], ["held back", "pause"], ["closed", "closed"],
    ["cancelled", "ban"], ["not verified", "help"], ["not started", "dashed"],
    ["running", "loader"], ["implementing", "loader"], ["implementerer", "loader"],
  ])("%p takes %p", (word, icon) => {
    expect(stateIconName(word)).toBe(icon);
  });

  test("a word with no icon of its own gets none, and the badge no attribute", () => {
    expect(stateIconName("–")).toBe("");
    expect(badge("idle", "–")).toBe('<span class="badge b-idle">–</span>');
  });

  test("the badge names its icon after the class, and keeps the word as it was", () => {
    expect(badge("done", "archived")).toBe('<span class="badge b-done" data-icon="archive">Archived</span>');
  });
});
