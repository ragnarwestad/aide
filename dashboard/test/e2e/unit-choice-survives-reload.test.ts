// The unit a reader picks in the header menu is restored by the script
// after a reload; the server renders the default every time.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";

browserDeadline();

const DESKTOP = { width: 1270, height: 800 };

const harness = queueHarness("aide-e2e-chosen-option-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start();
  base = started.base;
  ran(started.dir, []);
  await new Promise((r) => setTimeout(r, 400));
  await withBrowser(page.goto(`${base}/?live=0`), "page.goto(/?live=0)");
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
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
