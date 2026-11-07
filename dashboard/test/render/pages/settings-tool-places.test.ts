// A provider's Installation tab opens with a sentence naming where aide
// installs for that tool, from the same table the preflight prints.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../../../src/i18n";
import { esc } from "../../../src/render/ui/html.ts";
import {
  INSTALL_TARGETS,
  parseInstallTargets,
  placesOf,
} from "../../../src/render/pages/settings-page/places.ts";
import { CHECKABLE_TOOLS, toolWhere } from "../../../src/render/pages/settings-page/tools.ts";
import { providerDetail } from "../../../src/render/pages/settings-page/provider-detail.ts";
import { modelsBlock } from "../../../src/render/pages/settings-page/models.ts";

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

describe("the sentence on the Installation tab", () => {
  test.each([...CHECKABLE_TOOLS])("%s's names every place the table gives it", (tool) => {
    const rows = INSTALL_TARGETS.filter((row) => row.tool === tool);
    expect(rows.length).toBeGreaterThan(0);
    const sentence = toolWhere("en", tool, placesOf(INSTALL_TARGETS, tool));
    for (const row of rows) expect(sentence).toContain(row.to);
    expect(sentence).not.toContain("{");
  });

  test("a table naming other places names those places", () => {
    const other = parseInstallTargets(
      "codex instructions core/AGENTS.md ~/.x/AGENTS.md\n" +
        "codex scripts core/scripts/ ~/.x/bin/\n" +
        "codex hookConfig core/implementations/codex/hooks/hooks.json ~/.x/hooks.json\n" +
        "codex hooks core/implementations/codex/hooks/ ~/.x/hooks/\n" +
        "codex skills core/skills/ ~/.x/skills/\n",
    );
    const sentence = toolWhere("en", "codex", placesOf(other, "codex"));
    for (const row of other) expect(sentence).toContain(row.to);
  });
});

test("a Norwegian reader gets the Norwegian sentence, tabs and model headings", () => {
  const detail = providerDetail({ key: "Codex", provider: { name: "Codex", tool: "codex" }, aiTab: "installation" }, 0, "nb");
  expect(detail).toContain(esc(toolWhere("nb", "codex", placesOf(INSTALL_TARGETS, "codex"))));
  for (const part of ["models", "installation"] as const) expect(detail).toContain(`>${t("nb", `settings.part.${part}`)}</a>`);
  const models = modelsBlock("codex", { reading: { tool: "codex", at: "2026-10-03T13:30:00.000Z", offered: [] } }, "", "nb");
  for (const heading of ["supported", "available", "gone"] as const) {
    expect(models).toContain(t("nb", `settings.models.${heading}`));
  }
  expect(t("nb", "settings.models.supported")).not.toBe(t("en", "settings.models.supported"));
});
