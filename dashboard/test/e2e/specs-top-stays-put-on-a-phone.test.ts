// On a phone held upright, the Specs page's header, tabs and filter row
// stay put and only the rows scroll under them — as they do held
// sideways and on a desktop. The whole page scrolling took the search
// and the New button away with the rows.
//
// Only a browser answers this: what scrolls is layout's answer.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, ownDirs, projectsRoot, settled, serve, TOKEN } from "../project/project-detail-route-fixtures.ts";

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
  page = await browser.newPage({ extraHTTPHeaders: { "x-aide-token": TOKEN } });
  // Enough rows to scroll on any phone.
  const root = projectsRoot({ aide: "" });
  for (let i = 2; i < 32; i++) {
    const dir = join(root, "aide", "specs", `${String(i).padStart(2, "0")}-spec-number-${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1-description.md"), `# Spec ${i} - Description\n`);
  }
  base = serve(root, settled(root, "aide"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

for (const [w, h] of [[360, 640], [390, 844]] as const) {
  test(`at ${w}x${h}, the rows scroll and the header and the filter row stay where they were`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await withTimeout(page.goto(`${base}/?live=0`), 10_000, `page.goto at ${w}x${h}`);
    const searchBefore = await page.locator("form.specsearch").evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const after = await page.evaluate(() => {
      const box = document.querySelector("#jobrows .tablewrap") as HTMLElement;
      box.scrollTop = 400;
      window.scrollTo(0, 400);
      return {
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        rowsScrolled: box.scrollTop > 0,
        headerTop: Math.round(document.querySelector("header")!.getBoundingClientRect().top),
        searchTop: Math.round(document.querySelector("form.specsearch")!.getBoundingClientRect().top),
      };
    });
    expect(after).toEqual({ pageScrolls: false, rowsScrolled: true, headerTop: 0, searchTop: searchBefore });
  });
}
