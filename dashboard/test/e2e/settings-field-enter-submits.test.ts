// A project's Config tab: a settings field is a textarea that
// wraps a long value, yet Enter in it submits the form once and adds no line
// break, and a pasted break is folded. Only a browser runs that script.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { harness, ownDirs, projectsRoot, settled, serve } from "../project/detail/project-detail-route-fixtures.ts";
import { rmSync } from "node:fs";

browserDeadline();

let browser: Browser;
let page: Page;
let base: string;

const LONG_PATH = "/var/folders/44/7wtwdqq94j3gnkjtnyfjp71w0000gn/T/tmp.AYE5D1XGWT/specs";

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage({ extraHTTPHeaders: {} });
  const root = projectsRoot({ paceup: `AIDE_SPECS_PATH=${LONG_PATH}\n` }, ["pnpm-lock.yaml"]);
  base = serve(root, settled(root, "paceup"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

async function openConfig(width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await withBrowser(page.goto(`${base}/projects/paceup?tab=config`), `config page.goto at ${width}px`);
}

const specsField = () => page.locator('textarea[name="specsPath"]');

test("Enter raises one submit and leaves no line break; a filled break is folded", async () => {
  await openConfig(1280);
  await page.evaluate(() => {
    (window as unknown as { __submits: number }).__submits = 0;
    document.querySelector('form.projectsettingsform:has([name="specsPath"])')!.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      (window as unknown as { __submits: number }).__submits++;
    }, true);
  });
  await specsField().fill("/a");
  await specsField().press("Enter");
  expect(await page.evaluate(() => (window as unknown as { __submits: number }).__submits)).toBe(1);
  expect(await specsField().inputValue()).toBe("/a");
  await specsField().fill("a\nb");
  expect(await specsField().inputValue()).toBe("a b");
});
