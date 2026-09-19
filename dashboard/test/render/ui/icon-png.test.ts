// Spec 505: the rasterizer that draws the icon SVG as a PNG, checked against
// the pixels it produces.
import { describe, expect, test } from "bun:test";
import { appIcon, appIconMaskable } from "../../../src/render/ui/brand.ts";
import { rasterizeIcon } from "../../../src/render/ui/icon-png.ts";
import { THEME_COLORS } from "../../../src/render/ui/pwa.ts";
import { barCentres, coloredBox, decodePng, hexRgb, readIconSvg } from "../../helpers/icon-image.ts";

describe("the maskable PNG keeps the mark inside the safe circle (AC-2)", () => {
  const png = decodePng(rasterizeIcon(appIconMaskable(THEME_COLORS.light), 512));
  const canvas = hexRgb(THEME_COLORS.light);

  test("every coloured pixel lies within 40% of the width of the centre, and there is no alpha", () => {
    expect(png.colorType).toBe(2);
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        if (png.pixel(x, y).every((v, i) => v === canvas[i])) continue;
        expect(Math.hypot(x + 0.5 - 256, y + 0.5 - 256)).toBeLessThanOrEqual(512 * 0.4 + 1);
      }
  });
});

describe("the PNG shows the SVG's artwork (AC-3)", () => {
  const cases: [string, string, number][] = [
    ["plain at 512", appIcon(THEME_COLORS.light), 512],
    ["plain at 192", appIcon(THEME_COLORS.light), 192],
    ["maskable at 512", appIconMaskable(THEME_COLORS.light), 512],
  ];
  for (const [name, svg, size] of cases) {
    test(`${name}: canvas corner, bar colours and extent match the SVG (AC-3)`, () => {
      const png = decodePng(rasterizeIcon(svg, size));
      expect([png.width, png.height]).toEqual([size, size]);
      const { canvas, bars } = readIconSvg(svg);
      expect(png.pixel(0, 0)).toEqual(hexRgb(canvas));
      expect(barCentres(png, bars)).toEqual(bars.map((b) => hexRgb(b.fill)));
      const k = size / 64;
      const box = coloredBox(png, hexRgb(canvas));
      expect(Math.abs(box.x0 - Math.min(...bars.map((b) => b.x0)) * k)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x1 - Math.max(...bars.map((b) => b.x1)) * k)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y0 - Math.min(...bars.map((b) => b.y0)) * k)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y1 - Math.max(...bars.map((b) => b.y1)) * k)).toBeLessThanOrEqual(1);
    });
  }
});

describe("the rasterizer refuses an SVG it does not understand (AC-3)", () => {
  const good = appIcon(THEME_COLORS.light);
  const bad: [string, string][] = [
    ["an empty svg", "<svg/>"],
    ["a circle where a bar belongs", good.replace(/<rect x="24"[^>]*\/>/, '<circle r="3"/>')],
    ["three bars", good.replace(/<rect x="24"[^>]*\/>/, "")],
    ["an extra circle", good.replace("</g>", '<circle r="3"/></g>')],
  ];
  for (const [name, svg] of bad) {
    test(`${name} throws (AC-3)`, () => {
      expect(() => rasterizeIcon(svg, 64)).toThrow();
    });
  }
});
