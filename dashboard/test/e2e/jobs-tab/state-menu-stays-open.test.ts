import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();
const harness = queueHarness("aide-e2e-state-menu-open-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start().base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

test("ticking a state filters the list and leaves the menu open until Escape", async () => {
  await withBrowser(page.goto(`${base}/?live=0&state=all`), "page.goto(/)");
  const menu = page.locator('details.menu[data-filter="state"]');
  await menu.locator("summary").click();
  expect(await page.locator("#spec-aide\\/81-queue-and-runner").count()).toBe(1);

  await menu.locator('.menupanel a[href*="state=failed"]').first().click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("state") === "failed");
  await page.locator("#spec-aide\\/81-queue-and-runner").waitFor({ state: "detached" });
  expect(await page.locator('details.menu[data-filter="state"]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);

  await page.keyboard.press("Escape");
  expect(await page.locator('details.menu[data-filter="state"]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
});
