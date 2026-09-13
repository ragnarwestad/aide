// Spec 443, AC-1/AC-2/AC-3: dashboard/CLAUDE.md states the four code-health
// limits, the three filename exemptions and the split-by-responsibility
// rule — pinned here so a future edit cannot drop the wording silently.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOC = readFileSync(join(import.meta.dir, "..", "..", "CLAUDE.md"), "utf-8");

describe("dashboard/CLAUDE.md states the code-health limits (AC-1)", () => {
  test("names the four limits", () => {
    expect(DOC).toContain("500 lines");
    expect(DOC).toContain("800 lines");
    expect(DOC).toContain("15");
    expect(DOC).toContain("a source file's tests live under the matching path");
  });
});

describe("dashboard/CLAUDE.md names the filename exemptions (AC-2)", () => {
  test("exempts messages.ts, en.ts and nb.ts by filename", () => {
    expect(DOC).toContain("messages.ts");
    expect(DOC).toContain("en.ts");
    expect(DOC).toContain("nb.ts");
    expect(DOC).toContain("exempt");
  });
});

describe("dashboard/CLAUDE.md states the split-by-responsibility rule (AC-3)", () => {
  test("says a file is split by responsibility, not by size", () => {
    expect(DOC).toContain("split by responsibility");
  });

  test("says new functionality goes into its own file", () => {
    expect(DOC).toContain("its own file rather than being appended");
  });
});
