// The unit a reader picks in the header menu is restored by the script
// after a reload; the server renders the default every time.

import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { e2eBrowser, pageOnRunning } from "../helpers/setup/e2e-browser.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const DESKTOP = { width: 1270, height: 800 };

const harness = queueHarness("aide-e2e-chosen-option-");
let page: Page;
let base: string;

e2eBrowser(harness, async (browser) => {
  ({ page, base } = await pageOnRunning(browser, harness));
});

test("the unit menu's stored choice is the one selected after a reload", async () => {
  await page.setViewportSize(DESKTOP);
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/)");
  await page.locator(".menu.unit > summary").click();
  await page.locator('.menu.unit [data-unit-choice="tokens"]').check();

  // The server renders "$" selected every time — which unit a reader
  // picked is theirs, not the server's. Only the script restores it, and
  // only a real browser runs the script.
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/) again");
  await page.locator(".menu.unit > summary").click();
  expect(await page.locator('.menu.unit [data-unit-choice="tokens"]').isChecked()).toBe(true);
  expect(await page.locator('.menu.unit [data-unit-choice="usd"]').isChecked()).toBe(false);
});
