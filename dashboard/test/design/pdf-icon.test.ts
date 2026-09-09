// The spec page's PDF control is a red PDF icon — Bootstrap Icons'
// file-earmark-pdf, filled — standing on its own, not a button with a
// plain document outline in it (asked twice; the first attempt drew a
// blank sheet inside a .btn).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ICON_PDF } from "../../src/render/ui/components.ts";

const CSS = readFileSync(join(import.meta.dir, "../../src/render/ui/css/button.css"), "utf-8");

describe("the PDF control is a red PDF icon, not a button", () => {
  test("the icon is Bootstrap Icons' file-earmark-pdf, filled, carrying the red class", () => {
    expect(ICON_PDF).toContain('class="icon-pdf"');
    expect(ICON_PDF).toContain('fill="currentColor"');
    expect(ICON_PDF).not.toContain("stroke=");
    // The PDF mark's own path, not just a sheet with a folded corner.
    expect(ICON_PDF).toContain("M4.603 14.087");
  });

  test("the class colours it red in every theme, and .iconlink draws no frame", () => {
    expect(CSS).toContain(".icon-pdf { color: var(--pdf); }");
    const iconlink = CSS.match(/\.iconlink \{[^}]*\}/)?.[0] ?? "";
    expect(iconlink).not.toContain("border:");
    expect(iconlink).not.toContain("background:");
  });
});
