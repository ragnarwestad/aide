// Each AI tab's opening sentence names where aide installs for that AI,
// from the same table the preflight prints, and what a press of Check
// finds out sits behind a "(?)" in the reader's language.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { helpPopover } from "../../../src/render/ui/components";
import { t } from "../../../src/i18n";
import {
  INSTALL_TARGETS,
  parseInstallTargets,
  placesOf,
} from "../../../src/render/pages/settings-page/places.ts";
import { checkHelp, toolPanel, toolWhere, TOOL_TABS } from "../../../src/render/pages/settings-page/tools.ts";

const TABLE = join(import.meta.dir, "../../../../core/scripts/lib/install-targets.txt");

describe("the table of places", () => {
  test("a blank line and a comment are skipped, and a short line throws naming it (AC-4)", () => {
    const text = "# where aide installs\n\nclaude  skills  core/skills/  ~/.claude/skills/\n";
    expect(parseInstallTargets(text)).toEqual([
      { tool: "claude", place: "skills", from: "core/skills/", to: "~/.claude/skills/" },
    ]);
    expect(() => parseInstallTargets("claude skills ~/.claude/skills/\n")).toThrow("claude skills ~/.claude/skills/");
  });

  test("the dashboard's places are exactly the rows of core/scripts/lib/install-targets.txt (AC-4)", () => {
    expect(INSTALL_TARGETS).toEqual(parseInstallTargets(readFileSync(TABLE, "utf-8")));
  });
});

describe("the sentence above Check", () => {
  test.each([...TOOL_TABS])("%s's names every place the table gives it (AC-1)", (tool) => {
    const rows = INSTALL_TARGETS.filter((row) => row.tool === tool);
    expect(rows.length).toBeGreaterThan(0);
    const sentence = toolWhere("en", tool, placesOf(INSTALL_TARGETS, tool));
    for (const row of rows) expect(sentence).toContain(row.to);
    expect(sentence).not.toContain("{");
  });

  test("a table naming other places names those places (AC-4)", () => {
    const other = parseInstallTargets(
      "codex instructions core/AGENTS.md ~/.x/AGENTS.md\n" +
        "codex scripts core/scripts/ ~/.x/bin/\n" +
        "codex hookConfig implementations/codex/hooks/hooks.json ~/.x/hooks.json\n" +
        "codex hooks implementations/codex/hooks/ ~/.x/hooks/\n" +
        "codex skills core/skills/ ~/.x/skills/\n",
    );
    const sentence = toolWhere("en", "codex", placesOf(other, "codex"));
    for (const row of other) expect(sentence).toContain(row.to);
  });
});

describe("what Check finds out", () => {
  test.each([...TOOL_TABS])("%s's panel holds it in the Settings page's own (?) (AC-2)", (tool) => {
    const html = toolPanel(tool, undefined);
    expect(html).toContain(helpPopover(t("en", "settings.checkHelpTitle"), checkHelp("en", tool)));
  });

  test("Copilot's (?) also says what the check cannot tell (AC-3)", () => {
    expect(checkHelp("en", "copilot")).toContain(t("en", "settings.checkCannot.copilot"));
  });
});

test("a Norwegian reader gets the Norwegian sentence and (?) (AC-5)", () => {
  const html = toolPanel("copilot", undefined, undefined, Date.now(), {}, "nb");
  expect(html).toContain(toolWhere("nb", "copilot", placesOf(INSTALL_TARGETS, "copilot")));
  expect(html).toContain(helpPopover(t("nb", "settings.checkHelpTitle"), checkHelp("nb", "copilot")));
  expect(toolWhere("nb", "copilot", placesOf(INSTALL_TARGETS, "copilot")))
    .not.toBe(toolWhere("en", "copilot", placesOf(INSTALL_TARGETS, "copilot")));
});
