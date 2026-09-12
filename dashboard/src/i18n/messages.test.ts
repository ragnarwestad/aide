import { describe, expect, test } from "bun:test";
import { MESSAGES, type MessageEntry } from "./messages.ts";

// REQ-6, proven here first against the catalog itself, before the
// registry test (test/render/ui/error-sentence-registry.test.ts) is
// rewritten to depend on it.
describe("every board message names its own resolution or a named exemption (REQ-6)", () => {
  test.each(Object.entries(MESSAGES) as [string, MessageEntry][])("%s", (_key, entry) => {
    expect(entry.resolve || entry.exempt).toBeTruthy();
    if (entry.resolve) expect(entry.en).toContain(entry.resolve);
  });

  test("every entry also carries a Norwegian text", () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.nb, `${key} has no nb text`).toBeTruthy();
    }
  });
});

// Spec 442: every message starts with an uppercase letter, unless it
// opens with a `{placeholder}` — a dynamic value substituted at render
// time, which is exempt (the value, not this catalog's text, decides
// the first character then).
describe("every board message starts with an uppercase letter, or a {placeholder} (spec 442)", () => {
  test.each(Object.entries(MESSAGES) as [string, MessageEntry][])("%s", (_key, entry) => {
    for (const text of [entry.en, entry.nb]) {
      expect(/^(\{|[A-ZÆØÅ])/.test(text)).toBe(true);
    }
  });
});
