// A spec's name on the Specs list wraps under ITSELF: the second line
// starts where the number does, right after "aide:", not back under
// the project (asked for 2026-09-10). The label is a flex row of the
// project and the name, and the two-line clamp sits on the name.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/render/ui/css/list.css", import.meta.url), "utf8");

describe("the spec's name hangs under itself when it wraps", () => {
  test("the label is a flex row, and the clamp is on the name, not the label", () => {
    const label = /\.spec-name > \.label \{([^}]*)\}/.exec(css)![1]!;
    expect(label).toMatch(/display: flex/);
    expect(label).not.toMatch(/line-clamp/);
    const name = /\.spec-name > \.label > \.specname \{([^}]*)\}/.exec(css)![1]!;
    expect(name).toMatch(/-webkit-line-clamp: 2/);
    expect(name).toMatch(/min-width: 0/);
    expect(/\.spec-name > \.label > \.muted \{[^}]*flex: 0 0 auto/.test(css)).toBe(true);
  });
});
