import { describe, expect, test } from "bun:test";
import { groupIn, stripGroupLines, withGroupLines } from "../../../src/project/discover";

const description = (lines = "") =>
  `# X\n\n## Tracking info\n\n- **Task:** \`1-x/\`\n- **Created:** \`2026-11-11\`\n${lines ? `${lines}\n` : ""}\n---\n`;

describe("spec group metadata", () => {
  test("reads a complete pair and rejects incomplete or invalid pairs (A757 AC-3)", () => {
    expect(groupIn(description("- **Group:** `Release`\n- **Group position:** 2"))).toEqual({ name: "Release", position: 2 });
    expect(groupIn(description("- **Group:** `Release`"))).toBeUndefined();
    expect(groupIn(description("- **Group:** `Release`\n- **Group position:** 0"))).toBeUndefined();
  });

  test("writes, replaces and removes the pair atomically (A757 AC-3)", () => {
    const written = withGroupLines(description(), { name: "Release", position: 1 });
    expect(groupIn(written!)).toEqual({ name: "Release", position: 1 });
    expect(withGroupLines(written!, undefined)).toBe(description());
    expect(stripGroupLines(written!)).toBe(description());
  });
});
