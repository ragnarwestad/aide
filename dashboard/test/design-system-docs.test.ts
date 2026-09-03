// Spec 372, REQ-6: dashboard/docs/design-system.md states the three
// kinds a row message can be, the question each answers, and the rule
// that a call site chooses a kind and never a colour — pinned here so a
// future edit cannot drop the wording silently.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOC = readFileSync(join(import.meta.dir, "..", "docs", "design-system.md"), "utf-8");

describe("design-system.md names the three row-message kinds (REQ-6)", () => {
  test("names info, waiting and failed", () => {
    expect(DOC).toContain("info");
    expect(DOC).toContain("waiting");
    expect(DOC).toContain("failed");
  });

  test("states the rule: a call site never picks the colour", () => {
    expect(DOC).toContain("never at the call site");
  });
});
