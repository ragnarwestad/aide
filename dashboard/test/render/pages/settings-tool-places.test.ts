// A provider's Installation tab draws a table of where aide installs for
// that tool, from the same table the preflight reads.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../../../src/i18n";
import {
  INSTALL_TARGETS,
  PLACE_HOLDS,
  parseInstallTargets,
} from "../../../src/render/pages/settings-page/places.ts";
import { installationBlock } from "../../../src/render/pages/settings-page/installation.ts";
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

describe("what a place holds", () => {
  test("every place in the table has one of the five labels, and both places for hooks read Hooks (AC-1)", () => {
    const labels = new Set(["instructions", "rules", "skills", "scripts", "hooks"]);
    for (const row of INSTALL_TARGETS) expect(labels.has(PLACE_HOLDS[row.place] as string), row.place).toBe(true);
    expect(PLACE_HOLDS.hookConfig).toBe("hooks");
    expect(PLACE_HOLDS.hooks).toBe("hooks");
  });
});

test("a Norwegian reader gets the Norwegian labels, tabs and model headings", () => {
  const detail = providerDetail({ key: "Codex", provider: { name: "Codex", tool: "codex" }, aiTab: "installation" }, 0, "nb");
  const table = installationBlock({ tool: "codex", at: "2026-10-03T13:30:00.000Z", found: true, extra: [] }, "nb");
  expect(table).toContain(`>${t("nb", "settings.install.holds.instructions")}<`);
  expect(t("nb", "settings.install.holds.instructions")).not.toBe(t("en", "settings.install.holds.instructions"));
  for (const part of ["models", "installation"] as const) expect(detail).toContain(`>${t("nb", `settings.part.${part}`)}</a>`);
  const models = modelsBlock("codex", { reading: { tool: "codex", at: "2026-10-03T13:30:00.000Z", offered: [] } }, "", "nb");
  for (const heading of ["supported", "available", "gone"] as const) {
    expect(models).toContain(t("nb", `settings.models.${heading}`));
  }
  expect(t("nb", "settings.models.supported")).not.toBe(t("en", "settings.models.supported"));
});
