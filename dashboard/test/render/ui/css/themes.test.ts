import { expect, test } from "bun:test";
import { TOKENS_CSS } from "../../../../src/render/ui/css";
import { THEMES } from "../../../../src/render/ui/css/themes.ts";

test("all six themes declare light and dark colour pairs (AC-3, AC-7, AC-8, AC-14)", () => {
  expect(THEMES).toEqual(["default", "maroon", "grove", "ocean", "ember", "iris"]);
  for (const theme of THEMES) {
    const selector = theme === "default" ? `:root, [data-palette="default"]` : `[data-palette="${theme}"]`;
    const start = TOKENS_CSS.indexOf(`${selector} {`);
    const block = start < 0 ? "" : TOKENS_CSS.slice(start, TOKENS_CSS.indexOf("}", start));
    for (const token of ["accent", "accent-strong", "accent-soft", "logo", "bg", "surface", "surface-2"])
      for (const side of ["l", "d"]) expect(block).toMatch(new RegExp(`--${token}-${side}: #[0-9A-F]{6}`));
    expect(block).not.toMatch(/--(?:ok|warn|danger|running)/);
  }
  expect(TOKENS_CSS).toContain('--accent-l: #A8331A');
  expect(TOKENS_CSS).toContain('--accent-d: #DA5A34');
});
