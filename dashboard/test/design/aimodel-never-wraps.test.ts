// The AI/model pair on a phase line is one line, always (2026-09-10):
// as an inline span it wrapped — Model under AI — the moment the phase
// column was narrower than the two selects, in the window widths
// between the phone layout and the table's full width. The row's own
// `flex-wrap: nowrap` cannot reach inside the span, so the span has to
// say it itself.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/render/ui/css/list.css", import.meta.url), "utf8");

describe("the AI/model pair never wraps", () => {
  test(".aimodel is a non-wrapping flex row on the desktop", () => {
    const rule = /\n\.aimodel \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/display: flex/);
    expect(rule).toMatch(/flex-wrap: nowrap/);
  });
});
