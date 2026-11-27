// A provider's Installation tab draws a table of where aide installs for
// that tool, from the same table the preflight reads.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSTALL_TARGETS,
  PLACE_HOLDS,
  parseInstallTargets,
} from "../../../src/render/pages/settings-page/places.ts";

const TABLE = join(import.meta.dir, "../../../../core/scripts/lib/install-targets.txt");

describe("the table of places", () => {
  test("a blank line and a comment are skipped, and a short line throws naming it", () => {
    const text = "# where aide installs\n\nclaude  skills  core/skills/  ~/.claude/skills/\n";
    expect(parseInstallTargets(text)).toEqual([
      { tool: "claude", place: "skills", from: "core/skills/", to: "~/.claude/skills/" },
    ]);
    expect(() => parseInstallTargets("claude skills ~/.claude/skills/\n")).toThrow("claude skills ~/.claude/skills/");
  });

  test("the dashboard's places are exactly the rows of core/scripts/lib/install-targets.txt", () => {
    expect(INSTALL_TARGETS).toEqual(parseInstallTargets(readFileSync(TABLE, "utf-8")));
  });
});

describe("what a place holds", () => {
  test("every place in the table has one of the five labels, and both places for hooks read Hooks (AC-1)", () => {
    const labels = new Set(["instructions", "rules", "skills", "scripts", "hooks"]);
    for (const row of INSTALL_TARGETS) expect(labels.has(PLACE_HOLDS[row.place] as string), row.place).toBe(true);
    expect(PLACE_HOLDS.hookConfig).toBe("hooks");
    expect(PLACE_HOLDS.hooks).toBe("hooks");
  });
});
