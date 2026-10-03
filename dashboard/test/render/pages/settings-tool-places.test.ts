// Each AI tab's opening sentence names where aide installs for that AI,
// from the same table the preflight prints, and each of its three tabs has
// a Check of its own, with what that Check reads behind a "(?)" in the
// reader's language.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { helpPopover } from "../../../src/render/ui/components";
import { t } from "../../../src/i18n";
import {
  INSTALL_TARGETS,
  parseInstallTargets,
  placesOf,
} from "../../../src/render/pages/settings-page/places.ts";
import {
  checkHelp, toolPanel, toolWhere, TOOL_PARTS, TOOL_TABS,
} from "../../../src/render/pages/settings-page/tools.ts";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

/** Each form on the panel that posts a Check, as the fields it posts. */
function checkForms(html: string): Record<string, string>[] {
  const win = new Window();
  windows.push(win);
  win.document.write(html);
  return Array.from(win.document.querySelectorAll("form"))
    .filter((f) => f.getAttribute("action") === "/api/queue/settings/check")
    .map((f) => Object.fromEntries(
      Array.from(f.querySelectorAll("input")).map((i) => [i.getAttribute("name") ?? "", i.getAttribute("value") ?? ""]),
    ));
}

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

describe("each tab's own Check", () => {
  for (const tool of TOOL_TABS) {
    test.each([...TOOL_PARTS])(`${tool}'s %s tab has one Check posting the AI and that tab, with its own (?) (AC-3)`, (part) => {
      const html = toolPanel(tool, undefined, undefined, Date.now(), {}, "en", part);
      expect(checkForms(html)).toEqual([{ tool, part }]);
      expect(html).toContain(helpPopover(t("en", "settings.checkHelpTitle"), checkHelp("en", tool, part)));
    });
  }

  test.each([...TOOL_TABS])("%s's three (?) say three different things (AC-3)", (tool) => {
    expect(new Set(TOOL_PARTS.map((part) => checkHelp("en", tool, part))).size).toBe(3);
  });
});

test("a Norwegian reader gets the Norwegian sentence, tabs, (?) and model headings (AC-15)", () => {
  const html = toolPanel("codex", undefined, undefined, Date.now(), {
    reading: { tool: "codex", at: "2026-10-03T13:30:00.000Z", offered: [] },
  }, "nb");
  expect(html).toContain(toolWhere("nb", "codex", placesOf(INSTALL_TARGETS, "codex")));
  for (const part of TOOL_PARTS) expect(html).toContain(`>${t("nb", `settings.part.${part}`)}</a>`);
  expect(html).toContain(helpPopover(t("nb", "settings.checkHelpTitle"), checkHelp("nb", "codex", "models")));
  for (const heading of ["supported", "available", "gone"] as const) {
    expect(html).toContain(t("nb", `settings.models.${heading}`));
  }
  expect(t("nb", "settings.models.supported")).not.toBe(t("en", "settings.models.supported"));
});
