// A project's Config tab on a phone: nothing scrolls sideways, reading
// or editing. As three columns, the settings table's fields and paths
// were wider than the screen — the page itself scrolled in Edit (646px
// on a 390px screen) and the table's own box scrolled while reading,
// with every comment off to the right. A checkout path under the
// readiness line widened the page on its own at 360px.
//
// Only a browser answers this: the stacking is a media query's, and the
// widths are layout's.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { harness, ownDirs, projectsRoot, settled, serve } from "../project/project-detail-route-fixtures.ts";
import { rmSync } from "node:fs";

setDefaultTimeout(30_000);

let browser: Browser;
let page: Page;
let base: string;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not resolve within ${ms}ms`)), ms),
    ),
  ]);
}

beforeAll(async () => {
  browser = await withTimeout(chromium.launch(), 15_000, "chromium.launch()");
  page = await browser.newPage({ extraHTTPHeaders: {} });
  // A long configured path and a lockfile, so the table carries a long
  // value, two notices and the test command's suggestion — its widest
  // content.
  const root = projectsRoot({ paceup: "AIDE_SPECS_PATH=/Users/someone/develop/paceup/specs-kept-somewhere-long\n" }, ["pnpm-lock.yaml"]);
  base = serve(root, settled(root, "paceup"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** How far the page, and the settings table's own box, reach past the
 *  window at `width` — 0 each when nothing scrolls sideways. */
async function overflow(width: number, edit: boolean): Promise<{ page: number; table: number }> {
  await page.setViewportSize({ width, height: 900 });
  await withTimeout(page.goto(`${base}/projects/paceup${edit ? "?edit=1" : ""}`), 10_000, `page.goto at ${width}px`);
  return page.evaluate((w) => {
    const wrap = document.querySelector(".tablewrap");
    return {
      page: document.documentElement.scrollWidth - w,
      table: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
    };
  }, width);
}

for (const width of [360, 390]) {
  for (const edit of [false, true]) {
    test(`at ${width}px, ${edit ? "editing" : "reading"}, nothing scrolls sideways`, async () => {
      expect(await overflow(width, edit)).toEqual({ page: 0, table: 0 });
    });
  }
}

test("on a desktop the table keeps its three columns, Value and Comment evenly", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withTimeout(page.goto(`${base}/projects/paceup`), 10_000, "page.goto at 1280px");
  const widths = await page
    .locator("table.list thead th")
    .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().width)));
  expect(widths).toHaveLength(3);
  expect(Math.abs(widths[1]! - widths[2]!)).toBeLessThanOrEqual(8);
});
