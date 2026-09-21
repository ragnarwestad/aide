// A phone held sideways is wide but short, and the header plus the tab
// bar under it took 107 of its 390px before the page began. There the
// tabs sit in the header's own row and the bar under it goes; a phone
// held upright and a desktop window keep the bar as it was.
//
// Only a browser answers this: which copy of the tabs shows is a media
// query's answer (orientation, height and width together).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { rmSync } from "node:fs";
import { harness, ownDirs, projectsRoot, settled, serve } from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage({ extraHTTPHeaders: {} });
  const root = projectsRoot({ aide: "" });
  base = serve(root, settled(root, "aide"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** Which copy of the tabs shows at this window size, and whether the
 *  page reaches past the window's width. */
async function tabsAt(width: number, height: number) {
  await page.setViewportSize({ width, height });
  await withBrowser(page.goto(`${base}/?live=0`), `page.goto at ${width}x${height}`);
  return page.evaluate((w) => {
    const shown = (sel: string) => {
      const e = document.querySelector(sel);
      return !!e && getComputedStyle(e).display !== "none";
    };
    return {
      inHeader: shown("header > nav.tabbar"),
      under: shown("body > nav.tabbar"),
      sideways: document.documentElement.scrollWidth - w,
    };
  }, width);
}

for (const [w, h] of [[667, 375], [844, 390], [932, 430]] as const) {
  test(`a phone held sideways (${w}x${h}) shows the tabs in the header, and no bar under it`, async () => {
    expect(await tabsAt(w, h)).toEqual({ inHeader: true, under: false, sideways: 0 });
  });
}

for (const [w, h, what] of [[390, 844, "a phone held upright"], [1280, 800, "a desktop window"], [1280, 420, "a short desktop window"]] as const) {
  test(`${what} (${w}x${h}) keeps the bar under the header`, async () => {
    expect(await tabsAt(w, h)).toEqual({ inHeader: false, under: true, sideways: 0 });
  });
}
