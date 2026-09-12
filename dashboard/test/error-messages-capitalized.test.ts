// Spec 442: a handful of board/CLI-facing strings that sit outside both
// the i18n catalog (messages.ts) and error-sentence.ts's builder — each
// gets a small, targeted capitalization check here rather than being
// left for a blanket rule that could not reach them.

import { describe, expect, spyOn, test } from "bun:test";
import { ARCHIVED_REFUSAL } from "../src/serve/serve-helpers/redirect.ts";
import { notLandedTitle } from "../src/render/pages/queue-list/cell-helpers.ts";
import { main } from "../src/main.ts";

describe("error messages that live outside the shared catalog/builder (spec 442)", () => {
  test("ARCHIVED_REFUSAL starts with an uppercase letter", () => {
    expect(ARCHIVED_REFUSAL).toMatch(/^[A-ZÆØÅ]/);
  });

  test("the not-landed hover title starts with an uppercase letter", () => {
    expect(notLandedTitle(undefined, Date.now())).toMatch(/^[A-ZÆØÅ]/);
  });

  test("main.ts's usage and unknown-argument errors start with an uppercase letter", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      main([]);
      main(["generate", "--bogus-flag"]);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const call of spy.mock.calls) expect(String(call[0])).toMatch(/^[A-ZÆØÅ]/);
    } finally {
      spy.mockRestore();
    }
  });
});
